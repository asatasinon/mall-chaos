package com.castrel.chaos.common.chaos;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
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
    private static final String QUERY_ENRICHMENT_KEY_PREFIX = "castrel:query:enrichment:";
    private static final Set<String> ALLOWED_JOIN_TABLES = Set.of("user_behavior_log", "product_price_history");

    private final DataSource dataSource;
    private final StringRedisTemplate redisTemplate;

    // ── Slow SQL state ──
    private volatile boolean slowSqlActive = false;
    private volatile String slowSqlJoinTable = "user_behavior_log";
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

    @Value("${spring.application.name:unknown}")
    private String serviceName;

    public ChaosService(DataSource dataSource, StringRedisTemplate redisTemplate) {
        this.dataSource = dataSource;
        this.redisTemplate = redisTemplate;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SLOW SQL
    // ═══════════════════════════════════════════════════════════════════════

    public void enableSlowSql(String joinTable, int durationSec) {
        String normalizedJoinTable = normaliseJoinTable(joinTable);
        this.slowSqlJoinTable = normalizedJoinTable;
        this.slowSqlStartedAt = Instant.now();
        this.slowSqlActive = true;

        redisTemplate.opsForHash().putAll(slowSqlRedisKey(), Map.of(
                "enabled", "true",
                "joinTable", normalizedJoinTable,
                "targetServices", serviceName
        ));

        cancelFuture(slowSqlAutoDisable);
        if (durationSec > 0) {
            slowSqlAutoDisable = scheduler.schedule(this::disableSlowSql, durationSec, TimeUnit.SECONDS);
        }
        log.info("Slow SQL enrichment enabled: service={}, joinTable={}, durationSec={}",
                serviceName, normalizedJoinTable, durationSec);
    }

    public void disableSlowSql() {
        slowSqlActive = false;
        cancelFuture(slowSqlAutoDisable);
        try {
            redisTemplate.opsForHash().putAll(slowSqlRedisKey(), Map.of(
                    "enabled", "false",
                    "joinTable", "",
                    "targetServices", serviceName
            ));
        } catch (Exception e) {
            log.warn("Failed to disable slow SQL enrichment in Redis: {}", e.getMessage());
        }
        log.info("Slow SQL enrichment disabled: service={}", serviceName);
    }

    public Map<String, Object> getSlowSqlStatus() {
        return Map.of(
                "active", slowSqlActive,
                "joinTable", slowSqlJoinTable,
                "service", serviceName,
                "startedAt", slowSqlStartedAt != null ? slowSqlStartedAt.toString() : "",
                "autoDisableAt", computeAutoDisableAt(slowSqlStartedAt, slowSqlAutoDisable)
        );
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

    private String slowSqlRedisKey() {
        return QUERY_ENRICHMENT_KEY_PREFIX + serviceName;
    }

    private String normaliseJoinTable(String joinTable) {
        if (joinTable == null || joinTable.isBlank()) {
            return "user_behavior_log";
        }
        if (!ALLOWED_JOIN_TABLES.contains(joinTable)) {
            throw new IllegalArgumentException("Unsupported joinTable: " + joinTable);
        }
        return joinTable;
    }
}
