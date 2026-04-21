package com.castrel.chaos.common.chaos;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
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
    private volatile int slowSqlLimitRows = 1;
    private volatile int slowSqlOffsetRows = 200000;
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
    private final AtomicBoolean deadlockInFlight = new AtomicBoolean(false);
    private final ExecutorService deadlockExecutor = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "chaos-deadlock-worker");
        t.setDaemon(true);
        return t;
    });

    @Value("${spring.application.name:unknown}")
    private String serviceName;

    public ChaosService(DataSource dataSource, StringRedisTemplate redisTemplate) {
        this.dataSource = dataSource;
        this.redisTemplate = redisTemplate;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SLOW SQL
    // ═══════════════════════════════════════════════════════════════════════

    public void enableSlowSql(String joinTable, int limitRows, int offsetRows, int durationSec) {
        String normalizedJoinTable = normaliseJoinTable(joinTable);
        int normalizedLimitRows = normalizeLimitRows(limitRows);
        int normalizedOffsetRows = normalizeOffsetRows(offsetRows);
        this.slowSqlJoinTable = normalizedJoinTable;
        this.slowSqlLimitRows = normalizedLimitRows;
        this.slowSqlOffsetRows = normalizedOffsetRows;
        this.slowSqlStartedAt = Instant.now();
        this.slowSqlActive = true;

        redisTemplate.opsForHash().putAll(slowSqlRedisKey(), Map.of(
                "enabled", "true",
                "joinTable", normalizedJoinTable,
                "targetServices", serviceName,
                "limitRows", Integer.toString(normalizedLimitRows),
                "offsetRows", Integer.toString(normalizedOffsetRows)
        ));

        cancelFuture(slowSqlAutoDisable);
        if (durationSec > 0) {
            slowSqlAutoDisable = scheduler.schedule(this::disableSlowSql, durationSec, TimeUnit.SECONDS);
        }
        log.info("Slow SQL enrichment enabled: service={}, joinTable={}, limitRows={}, offsetRows={}, durationSec={}",
                serviceName, normalizedJoinTable, normalizedLimitRows, normalizedOffsetRows, durationSec);
    }

    public void disableSlowSql() {
        slowSqlActive = false;
        cancelFuture(slowSqlAutoDisable);
        try {
            redisTemplate.opsForHash().putAll(slowSqlRedisKey(), Map.of(
                "enabled", "false",
                "joinTable", "",
                "targetServices", serviceName,
                "limitRows", Integer.toString(slowSqlLimitRows),
                "offsetRows", Integer.toString(slowSqlOffsetRows)
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
                "limitRows", slowSqlLimitRows,
                "offsetRows", slowSqlOffsetRows,
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
        if (!deadlockInFlight.compareAndSet(false, true)) return;

        try {
            triggerCoordinatedDeadlock("orders", "payments");
        } catch (Exception e) {
            log.warn("chaosType=deadlock event=deadlock_attempt_dispatch_failed service={} message={}",
                    serviceName, e.getMessage(), e);
        } finally {
            deadlockInFlight.set(false);
        }
    }

    private void triggerCoordinatedDeadlock(String tableA, String tableB) throws InterruptedException {
        CountDownLatch firstLockReady = new CountDownLatch(2);
        CountDownLatch done = new CountDownLatch(2);

        deadlockExecutor.submit(() -> lockInOrder(tableA, tableB, firstLockReady, done));
        deadlockExecutor.submit(() -> lockInOrder(tableB, tableA, firstLockReady, done));

        boolean finished = done.await(8, TimeUnit.SECONDS);
        if (!finished) {
            log.warn("chaosType=deadlock event=deadlock_attempt_timeout service={} tableA={} tableB={}",
                    serviceName, tableA, tableB);
        }
    }

    private void lockInOrder(String firstTable, String secondTable,
                             CountDownLatch firstLockReady, CountDownLatch done) {
        Connection conn = null;
        try {
            conn = dataSource.getConnection();
            conn.setAutoCommit(false);
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("SELECT * FROM " + firstTable + " WHERE id = 1 FOR UPDATE");
                firstLockReady.countDown();

                if (!firstLockReady.await(3, TimeUnit.SECONDS)) {
                    log.warn("chaosType=deadlock event=deadlock_barrier_timeout service={} firstTable={} secondTable={}",
                            serviceName, firstTable, secondTable);
                    return;
                }

                stmt.execute("SELECT * FROM " + secondTable + " WHERE id = 1 FOR UPDATE");
            }
            conn.commit();
        } catch (Exception e) {
            if (e instanceof SQLException sqlException) {
                log.warn(
                        "chaosType=deadlock event=deadlock_conflict_expected service={} table1={} table2={} sqlState={} errorCode={} message={}",
                        serviceName, firstTable, secondTable,
                        sqlException.getSQLState(), sqlException.getErrorCode(), sqlException.getMessage());
            } else {
                log.warn(
                        "chaosType=deadlock event=deadlock_conflict_expected service={} table1={} table2={} message={}",
                        serviceName, firstTable, secondTable, e.getMessage());
            }
        } finally {
            if (conn != null) {
                try {
                    conn.rollback();
                } catch (SQLException ignore) {
                    // ignored
                }
                try {
                    conn.close();
                } catch (SQLException ignore) {
                    // ignored
                }
            }
            done.countDown();
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

    private int normalizeLimitRows(int limitRows) {
        if (limitRows <= 0) return 1;
        return Math.min(limitRows, 1000);
    }

    private int normalizeOffsetRows(int offsetRows) {
        if (offsetRows < 0) return 0;
        return Math.min(offsetRows, 5_000_000);
    }
}
