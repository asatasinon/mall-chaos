package com.castrel.chaos.common.chaos;

import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Shared slow-SQL chaos service.
 * mode=sleep  → Thread.sleep(delayMs)
 * mode=real   → SELECT SLEEP(N) via JdbcTemplate (requires non-null jdbcTemplate)
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
        this.enabled = true;
        this.mode = (mode != null) ? mode : "sleep";
        this.delayMs = delayMs;
        this.injectRate = injectRate;
        if (durationSec > 0) {
            this.autoDisableAt = Instant.now().plusSeconds(durationSec);
            scheduler.schedule(this::disable, durationSec, TimeUnit.SECONDS);
        } else {
            this.autoDisableAt = null;
        }
        logEvent("INJECT");
    }

    public void disable() {
        this.enabled = false;
        this.autoDisableAt = null;
        logEvent("RESTORE");
    }

    private void logEvent(String action) {
        if (jdbcTemplate == null) return;
        try {
            jdbcTemplate.update(
                "INSERT INTO chaos_event_log (chaos_type, target_service, action) VALUES (?, ?, ?)",
                "SLOW_SQL", serviceName, action);
        } catch (Exception ignored) {}
    }

    /** Call at the beginning of a service layer method to inject latency. */
    public void injectIfNeeded() {
        if (!enabled) return;
        if (Math.random() > injectRate) return;

        if ("real".equals(mode) && jdbcTemplate != null) {
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
