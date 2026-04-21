package com.castrel.chaos.common.chaos;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Unified chaos injection service. Provides slow-sql, memory-leak, and deadlock
 * injection capabilities. Auto-registered via ServiceComponentAutoConfiguration.
 *
 * All enable operations support durationSec for auto-disable.
 */
@Service
@ConditionalOnProperty(name = "chaos.endpoints.enabled", havingValue = "true", matchIfMissing = true)
public class ChaosService {

    private static final Logger log = LoggerFactory.getLogger(ChaosService.class);

    private final DataSource dataSource;
    private final StringRedisTemplate redisTemplate;

    // ── Slow SQL state ──
    private volatile boolean slowSqlActive = false;
    private volatile String slowSqlMode = "real";
    private volatile int slowSqlDelayMs = 3000;
    private volatile double slowSqlInjectRate = 1.0;
    private volatile String slowSqlScope = "ALL";
    private volatile Instant slowSqlStartedAt;
    private ScheduledFuture<?> slowSqlAutoDisable;

    // ── Memory Leak state ──
    private volatile boolean memoryLeakActive = false;
    private volatile int memoryLeakChunkSizeKb = 512;
    private volatile int memoryLeakIntervalMs = 500;
    private volatile int memoryLeakMaxMb = 256;
    private volatile Instant memoryLeakStartedAt;
    private ScheduledFuture<?> memoryLeakAutoDisable;
    private final CopyOnWriteArrayList<byte[]> leakedChunks = new CopyOnWriteArrayList<>();
    private ScheduledFuture<?> memoryLeakAllocator;

    // ── Deadlock state ──
    private volatile boolean deadlockActive = false;
    private volatile double deadlockInjectRate = 0.5;
    private volatile String deadlockScope = "ALL";
    private volatile Instant deadlockStartedAt;
    private ScheduledFuture<?> deadlockAutoDisable;

    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(3, r -> {
        Thread t = new Thread(r, "chaos-scheduler");
        t.setDaemon(true);
        return t;
    });

    // ── Deadlock helper ──
    private final AtomicReference<ScheduledFuture<?>> deadlockTrigger = new AtomicReference<>();

    public ChaosService(DataSource dataSource, StringRedisTemplate redisTemplate) {
        this.dataSource = dataSource;
        this.redisTemplate = redisTemplate;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SLOW SQL
    // ═══════════════════════════════════════════════════════════════════════

    public void enableSlowSql(String mode, int delayMs, double injectRate, String scope, int durationSec) {
        this.slowSqlMode = mode != null ? mode : "real";
        this.slowSqlDelayMs = delayMs > 0 ? delayMs : 3000;
        this.slowSqlInjectRate = injectRate;
        this.slowSqlScope = scope != null ? scope : "ALL";
        this.slowSqlStartedAt = Instant.now();
        this.slowSqlActive = true;

        cancelFuture(slowSqlAutoDisable);
        if (durationSec > 0) {
            slowSqlAutoDisable = scheduler.schedule(this::disableSlowSql, durationSec, TimeUnit.SECONDS);
        }
        log.info("Slow SQL enabled: mode={}, delayMs={}, rate={}, durationSec={}", mode, delayMs, injectRate, durationSec);
    }

    public void disableSlowSql() {
        slowSqlActive = false;
        cancelFuture(slowSqlAutoDisable);
        log.info("Slow SQL disabled");
    }

    public Map<String, Object> getSlowSqlStatus() {
        return Map.of(
                "active", slowSqlActive,
                "mode", slowSqlMode,
                "delayMs", slowSqlDelayMs,
                "injectRate", slowSqlInjectRate,
                "scope", slowSqlScope,
                "startedAt", slowSqlStartedAt != null ? slowSqlStartedAt.toString() : "",
                "autoDisableAt", computeAutoDisableAt(slowSqlStartedAt, slowSqlAutoDisable)
        );
    }

    /**
     * Called by query interceptor or JDBC proxy to inject delay.
     * Returns true if slow SQL should be injected for this call.
     */
    public boolean shouldInjectSlowSql() {
        if (!slowSqlActive) return false;
        return Math.random() < slowSqlInjectRate;
    }

    public int getSlowSqlDelayMs() {
        return slowSqlDelayMs;
    }

    public String getSlowSqlMode() {
        return slowSqlMode;
    }

    /**
     * Execute SELECT SLEEP(N) inside the current transaction for "real" slow SQL mode.
     */
    public void executeSlowSqlSleep() {
        if (!"real".equals(slowSqlMode)) return;
        double sleepSeconds = slowSqlDelayMs / 1000.0;
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("SELECT SLEEP(" + sleepSeconds + ")");
        } catch (Exception e) {
            log.debug("Slow SQL SLEEP execution failed: {}", e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MEMORY LEAK
    // ═══════════════════════════════════════════════════════════════════════

    public void enableMemoryLeak(int chunkSizeKb, int intervalMs, int maxMb, int durationSec) {
        this.memoryLeakChunkSizeKb = chunkSizeKb > 0 ? chunkSizeKb : 512;
        this.memoryLeakIntervalMs = intervalMs > 0 ? intervalMs : 500;
        this.memoryLeakMaxMb = maxMb > 0 ? maxMb : 256;
        this.memoryLeakStartedAt = Instant.now();
        this.memoryLeakActive = true;

        cancelFuture(memoryLeakAutoDisable);
        cancelFuture(memoryLeakAllocator);

        // Start allocating memory
        memoryLeakAllocator = scheduler.scheduleAtFixedRate(() -> {
            if (!memoryLeakActive) return;
            long currentMb = (long) leakedChunks.size() * memoryLeakChunkSizeKb / 1024;
            if (currentMb >= memoryLeakMaxMb) return;
            byte[] chunk = new byte[memoryLeakChunkSizeKb * 1024];
            leakedChunks.add(chunk);
        }, 0, this.memoryLeakIntervalMs, TimeUnit.MILLISECONDS);

        if (durationSec > 0) {
            memoryLeakAutoDisable = scheduler.schedule(this::disableMemoryLeak, durationSec, TimeUnit.SECONDS);
        }
        log.info("Memory leak enabled: chunkKb={}, intervalMs={}, maxMb={}, durationSec={}",
                chunkSizeKb, intervalMs, maxMb, durationSec);
    }

    public void disableMemoryLeak() {
        memoryLeakActive = false;
        cancelFuture(memoryLeakAutoDisable);
        cancelFuture(memoryLeakAllocator);
        log.info("Memory leak injection stopped (leak retained: {} chunks)", leakedChunks.size());
    }

    public void cleanupMemoryLeak() {
        disableMemoryLeak();
        leakedChunks.clear();
        System.gc();
        log.info("Memory leak cleaned up");
    }

    public Map<String, Object> getMemoryLeakStatus() {
        long leakedMb = (long) leakedChunks.size() * memoryLeakChunkSizeKb / 1024;
        return Map.of(
                "active", memoryLeakActive,
                "chunkSizeKb", memoryLeakChunkSizeKb,
                "intervalMs", memoryLeakIntervalMs,
                "maxMb", memoryLeakMaxMb,
                "leakedMb", leakedMb,
                "chunks", leakedChunks.size(),
                "startedAt", memoryLeakStartedAt != null ? memoryLeakStartedAt.toString() : "",
                "autoDisableAt", computeAutoDisableAt(memoryLeakStartedAt, memoryLeakAutoDisable)
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DEADLOCK
    // ═══════════════════════════════════════════════════════════════════════

    public void enableDeadlock(double injectRate, String scope, int durationSec) {
        this.deadlockInjectRate = injectRate;
        this.deadlockScope = scope != null ? scope : "ALL";
        this.deadlockStartedAt = Instant.now();
        this.deadlockActive = true;

        cancelFuture(deadlockAutoDisable);

        // Periodically trigger deadlock attempts
        ScheduledFuture<?> prev = deadlockTrigger.getAndSet(
                scheduler.scheduleAtFixedRate(this::attemptDeadlock, 1, 2, TimeUnit.SECONDS)
        );
        cancelFuture(prev);

        if (durationSec > 0) {
            deadlockAutoDisable = scheduler.schedule(this::disableDeadlock, durationSec, TimeUnit.SECONDS);
        }
        log.info("Deadlock enabled: rate={}, scope={}, durationSec={}", injectRate, scope, durationSec);
    }

    public void disableDeadlock() {
        deadlockActive = false;
        cancelFuture(deadlockAutoDisable);
        ScheduledFuture<?> trigger = deadlockTrigger.getAndSet(null);
        cancelFuture(trigger);
        log.info("Deadlock disabled");
    }

    public void cleanupDeadlock() {
        disableDeadlock();
        log.info("Deadlock cleaned up");
    }

    public Map<String, Object> getDeadlockStatus() {
        return Map.of(
                "active", deadlockActive,
                "injectRate", deadlockInjectRate,
                "scope", deadlockScope,
                "startedAt", deadlockStartedAt != null ? deadlockStartedAt.toString() : "",
                "autoDisableAt", computeAutoDisableAt(deadlockStartedAt, deadlockAutoDisable)
        );
    }

    private void attemptDeadlock() {
        if (!deadlockActive) return;
        if (Math.random() > deadlockInjectRate) return;

        // Two concurrent transactions with swapped lock order
        ExecutorService exec = Executors.newFixedThreadPool(2);
        try {
            exec.submit(() -> lockInOrder("orders", "payments"));
            exec.submit(() -> lockInOrder("payments", "orders"));
        } catch (Exception e) {
            log.debug("Deadlock attempt error: {}", e.getMessage());
        } finally {
            exec.shutdown();
        }
    }

    private void lockInOrder(String table1, String table2) {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("SELECT * FROM " + table1 + " WHERE id = 1 FOR UPDATE");
                Thread.sleep(100);
                stmt.execute("SELECT * FROM " + table2 + " WHERE id = 1 FOR UPDATE");
            }
            conn.commit();
        } catch (Exception e) {
            log.debug("Deadlock injection (expected): {}", e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════════════

    private void cancelFuture(ScheduledFuture<?> future) {
        if (future != null && !future.isDone()) {
            future.cancel(false);
        }
    }

    private String computeAutoDisableAt(Instant startedAt, ScheduledFuture<?> autoDisableFuture) {
        if (autoDisableFuture == null || autoDisableFuture.isDone()) return "";
        long remainingSec = autoDisableFuture.getDelay(TimeUnit.SECONDS);
        return Instant.now().plusSeconds(remainingSec).toString();
    }
}
