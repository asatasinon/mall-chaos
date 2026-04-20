package com.castrel.chaos.common.chaos;

import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Shared slow-SQL chaos service.
 * <p>
 * Chaos state is persisted to {@code chaos_switch} so it survives restarts and
 * can be toggled directly via SQL without calling the REST endpoints.
 * <p>
 * mode=sleep → Thread.sleep(delayMs)   (application-side delay, no DB trace)
 * mode=real  → SELECT SLEEP(N)          (real DB-level wait; visible in slow-query log)
 */
public class SlowSqlChaosService {

    private final JdbcTemplate jdbcTemplate;
    private final String serviceName;
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "slow-sql-auto-disable");
                t.setDaemon(true);
                return t;
            });

    private volatile boolean enabled = false;
    private volatile String mode = "sleep";
    private volatile long delayMs = 1000;
    private volatile double injectRate = 1.0;
    private volatile Instant autoDisableAt;

    public SlowSqlChaosService(JdbcTemplate jdbcTemplate, String serviceName) {
        this.jdbcTemplate = jdbcTemplate;
        this.serviceName = serviceName != null ? serviceName : "unknown";
    }

    public void enable(String mode, long delayMs, double injectRate, int durationSec) {
        this.mode = (mode != null) ? mode : "sleep";
        this.delayMs = delayMs;
        this.injectRate = injectRate;
        Instant disableAt = durationSec > 0 ? Instant.now().plusSeconds(durationSec) : null;
        this.autoDisableAt = disableAt;
        this.enabled = true;
        persistSwitch(true, this.mode, delayMs, injectRate, durationSec, disableAt);
        if (durationSec > 0) {
            scheduler.schedule(this::disable, durationSec, TimeUnit.SECONDS);
        }
        logEvent("INJECT");
    }

    public void disable() {
        this.enabled = false;
        this.autoDisableAt = null;
        persistSwitch(false, this.mode, this.delayMs, this.injectRate, 0, null);
        logEvent("RESTORE");
    }

    /**
     * Restore active chaos configuration from {@code chaos_switch} on service startup.
     * Called by the auto-configuration immediately after this bean is created so that
     * any chaos enabled before a restart is automatically re-applied.
     */
    public void syncFromDb() {
        if (jdbcTemplate == null) return;
        try {
            Map<String, Object> row = jdbcTemplate.queryForMap(
                "SELECT enabled, mode, delay_ms, inject_rate, duration_sec, auto_disable_at " +
                "FROM chaos_switch WHERE service_name = ? AND scenario = 'slow_sql'",
                serviceName);
            if (((Number) row.get("enabled")).intValue() == 0) return;

            Object disableAtObj = row.get("auto_disable_at");
            if (disableAtObj != null) {
                Instant disableAt = ((Timestamp) disableAtObj).toInstant();
                if (disableAt.isBefore(Instant.now())) {
                    // Expired while service was down — mark disabled
                    persistSwitch(false, null, this.delayMs, this.injectRate, 0, null);
                    return;
                }
                this.autoDisableAt = disableAt;
                long remaining = Duration.between(Instant.now(), disableAt).getSeconds();
                if (remaining > 0) scheduler.schedule(this::disable, remaining, TimeUnit.SECONDS);
            }
            this.mode = (String) row.getOrDefault("mode", "sleep");
            this.delayMs = ((Number) row.get("delay_ms")).longValue();
            this.injectRate = ((Number) row.get("inject_rate")).doubleValue();
            this.enabled = true;
        } catch (Exception ignored) {
            // chaos_switch not yet created or row absent — start with defaults
        }
    }

    private void persistSwitch(boolean enabled, String mode, long delayMs,
                                double injectRate, int durationSec, Instant autoDisableAt) {
        if (jdbcTemplate == null) return;
        try {
            jdbcTemplate.update(
                "INSERT INTO chaos_switch " +
                "  (service_name, scenario, enabled, mode, delay_ms, inject_rate, duration_sec, auto_disable_at) " +
                "VALUES (?, 'slow_sql', ?, ?, ?, ?, ?, ?) " +
                "ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), mode=VALUES(mode), " +
                "  delay_ms=VALUES(delay_ms), inject_rate=VALUES(inject_rate), " +
                "  duration_sec=VALUES(duration_sec), auto_disable_at=VALUES(auto_disable_at)",
                serviceName, enabled ? 1 : 0, mode, delayMs, injectRate, durationSec,
                autoDisableAt != null ? Timestamp.from(autoDisableAt) : null);
        } catch (Exception ignored) {}
    }

    private void logEvent(String action) {
        if (jdbcTemplate == null) return;
        try {
            jdbcTemplate.update(
                "INSERT INTO chaos_event_log (chaos_type, target_service, action) VALUES (?, ?, ?)",
                "SLOW_SQL", serviceName, action);
        } catch (Exception ignored) {}
    }

    /** Intercept at a transaction boundary to inject latency simulating a slow query. */
    public void injectIfNeeded() {
        if (!enabled) return;
        if (Math.random() > injectRate) return;

        if ("real".equals(mode) && jdbcTemplate != null) {
            // Real DB-level delay — appears in MySQL slow-query log as SELECT SLEEP(N)
            double delaySec = delayMs / 1000.0;
            jdbcTemplate.execute("SELECT SLEEP(" + delaySec + ")");
        } else {
            try {
                Thread.sleep(delayMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public boolean isEnabled() { return enabled; }
    public String getMode() { return mode; }
    public long getDelayMs() { return delayMs; }
    public double getInjectRate() { return injectRate; }
    public Instant getAutoDisableAt() { return autoDisableAt; }
}
