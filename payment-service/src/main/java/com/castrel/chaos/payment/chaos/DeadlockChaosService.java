package com.castrel.chaos.payment.chaos;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Simulates concurrent payment-settlement batch jobs that process the same payment
 * rows in conflicting sequence, causing InnoDB to detect a circular wait and roll
 * back one of the transactions.
 * <p>
 * Chaos state is persisted to {@code chaos_switch} so it can be toggled via SQL
 * and survives service restarts.
 */
@Service
@Profile("chaos")
public class DeadlockChaosService {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

    private volatile boolean enabled = false;
    private volatile double injectRate = 0.3;
    private volatile Instant autoDisableAt;
    private final AtomicInteger deadlockCount = new AtomicInteger(0);
    private volatile String lastError;
    private ScheduledFuture<?> injectFuture;
    private ScheduledFuture<?> autoDisableFuture;

    private Counter deadlockCounter;
    // Thread names mimic a real background settlement worker pool
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(3, r -> {
        Thread t = new Thread(r, "payment-settle-worker");
        t.setDaemon(true);
        return t;
    });

    @PostConstruct
    void init() {
        deadlockCounter = Counter.builder("chaos.deadlock.count")
                .tag("service", "payment")
                .register(meterRegistry);
        syncFromDb();
    }

    public synchronized void enable(double injectRate, int durationSec) {
        this.injectRate = injectRate;
        Instant disableAt = durationSec > 0 ? Instant.now().plusSeconds(durationSec) : null;
        this.autoDisableAt = disableAt;
        persistSwitch(true, injectRate, durationSec, disableAt);
        activateInternal(injectRate, durationSec, disableAt);
    }

    public synchronized void disable() {
        this.enabled = false;
        this.autoDisableAt = null;
        if (injectFuture != null) injectFuture.cancel(false);
        persistSwitch(false, this.injectRate, 0, null);
    }

    public void clear() {
        disable();
        deadlockCount.set(0);
        lastError = null;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private void activateInternal(double injectRate, int durationSec, Instant disableAt) {
        this.enabled = true;
        this.injectRate = injectRate;
        this.autoDisableAt = disableAt;
        if (durationSec > 0) {
            autoDisableFuture = scheduler.schedule(this::disable, durationSec, TimeUnit.SECONDS);
        }
        if (injectFuture != null) injectFuture.cancel(false);
        injectFuture = scheduler.scheduleAtFixedRate(this::injectDeadlock, 0, 1, TimeUnit.SECONDS);
    }

    private void injectDeadlock() {
        if (!enabled || Math.random() > injectRate) return;
        long[] ids = pickTwoPaymentIds();
        if (ids == null) return;
        // Two concurrent settlement instances process the same row pair
        // in reversed order — this guarantees a circular lock wait
        CompletableFuture.runAsync(() -> batchSettle(ids[0], ids[1]), scheduler);
        CompletableFuture.runAsync(() -> batchSettle(ids[1], ids[0]), scheduler);
    }

    /**
     * Select two recent successful payment IDs dynamically so that the deadlock
     * targets are real business rows, not hardcoded test data.
     */
    private long[] pickTwoPaymentIds() {
        try {
            List<Long> ids = jdbcTemplate.queryForList(
                "SELECT id FROM payments WHERE status = 'SUCCESS' ORDER BY id DESC LIMIT 20",
                Long.class);
            if (ids.size() < 2) return null;
            int secondIdx = ids.size() > 4 ? 3 : 1;
            return new long[]{ids.get(0), ids.get(secondIdx)};
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Simulate a single settlement-batch pass that touches two payment rows in
     * the given sequence. Two concurrent passes with reversed sequences cause an
     * InnoDB deadlock when their row-lock acquisitions interleave.
     */
    private void batchSettle(long firstId, long secondId) {
        try {
            jdbcTemplate.execute("START TRANSACTION");
            jdbcTemplate.update("UPDATE payments SET updated_at = NOW() WHERE id = ?", firstId);
            Thread.sleep(40);
            jdbcTemplate.update("UPDATE payments SET updated_at = NOW() WHERE id = ?", secondId);
            jdbcTemplate.execute("ROLLBACK");
        } catch (Exception e) {
            try { jdbcTemplate.execute("ROLLBACK"); } catch (Exception ignored) {}
            if (e.getMessage() != null && e.getMessage().toLowerCase().contains("deadlock")) {
                deadlockCount.incrementAndGet();
                deadlockCounter.increment();
                lastError = e.getMessage();
                logDeadlock(e.getMessage());
            }
        }
    }

    private void syncFromDb() {
        try {
            List<java.util.Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT enabled, inject_rate, duration_sec, auto_disable_at " +
                "FROM chaos_switch WHERE service_name = 'payment-service' AND scenario = 'deadlock'");
            if (rows.isEmpty() || ((Number) rows.get(0).get("enabled")).intValue() == 0) return;

            java.util.Map<String, Object> row = rows.get(0);
            Object disableAtObj = row.get("auto_disable_at");
            if (disableAtObj != null) {
                Instant disableAt = ((Timestamp) disableAtObj).toInstant();
                if (disableAt.isBefore(Instant.now())) {
                    persistSwitch(false, this.injectRate, 0, null);
                    return;
                }
                long remaining = Duration.between(Instant.now(), disableAt).getSeconds();
                if (remaining > 0) {
                    activateInternal(((Number) row.get("inject_rate")).doubleValue(),
                            (int) remaining, disableAt);
                }
                return;
            }
            activateInternal(((Number) row.get("inject_rate")).doubleValue(), 0, null);
        } catch (Exception ignored) {}
    }

    private void persistSwitch(boolean enabled, double injectRate, int durationSec,
                                Instant autoDisableAt) {
        try {
            jdbcTemplate.update(
                "INSERT INTO chaos_switch " +
                "  (service_name, scenario, enabled, inject_rate, duration_sec, auto_disable_at) " +
                "VALUES ('payment-service', 'deadlock', ?, ?, ?, ?) " +
                "ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), inject_rate=VALUES(inject_rate), " +
                "  duration_sec=VALUES(duration_sec), auto_disable_at=VALUES(auto_disable_at)",
                enabled ? 1 : 0, injectRate, durationSec,
                autoDisableAt != null ? Timestamp.from(autoDisableAt) : null);
        } catch (Exception ignored) {}
    }

    private void logDeadlock(String error) {
        try {
            jdbcTemplate.update(
                "INSERT INTO chaos_event_log (chaos_type, target_service, action) VALUES (?, ?, ?)",
                "DEADLOCK", "payment-service", "INJECT");
        } catch (Exception ignored) {}
    }

    public boolean isEnabled() { return enabled; }
    public int getDeadlockCount() { return deadlockCount.get(); }
    public String getLastError() { return lastError; }
    public Instant getAutoDisableAt() { return autoDisableAt; }
}
