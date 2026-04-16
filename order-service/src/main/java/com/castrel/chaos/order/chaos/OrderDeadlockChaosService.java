package com.castrel.chaos.order.chaos;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

@Service
@Profile("chaos")
public class OrderDeadlockChaosService {

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

    private Counter deadlockCounter;
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(3, r -> {
        Thread t = new Thread(r, "deadlock-chaos-order");
        t.setDaemon(true);
        return t;
    });

    @PostConstruct
    void init() {
        deadlockCounter = Counter.builder("chaos.deadlock.count").tag("service", "order")
                .register(meterRegistry);
    }

    public synchronized void enable(double injectRate, int durationSec) {
        this.enabled = true;
        this.injectRate = injectRate;
        if (durationSec > 0) {
            this.autoDisableAt = Instant.now().plusSeconds(durationSec);
            scheduler.schedule(this::disable, durationSec, TimeUnit.SECONDS);
        }
        if (injectFuture != null) injectFuture.cancel(false);
        injectFuture = scheduler.scheduleAtFixedRate(this::injectDeadlock, 0, 2, TimeUnit.SECONDS);
    }

    public synchronized void disable() {
        this.enabled = false;
        this.autoDisableAt = null;
        if (injectFuture != null) injectFuture.cancel(false);
    }

    public void clear() {
        disable();
        deadlockCount.set(0);
        lastError = null;
    }

    private void injectDeadlock() {
        if (!enabled || Math.random() > injectRate) return;
        CompletableFuture.runAsync(this::txA, scheduler);
        CompletableFuture.runAsync(this::txB, scheduler);
    }

    private void txA() {
        try {
            jdbcTemplate.execute("START TRANSACTION");
            jdbcTemplate.execute("SELECT id FROM orders WHERE id = 1 FOR UPDATE");
            Thread.sleep(50);
            jdbcTemplate.execute("SELECT id FROM orders WHERE id = 2 FOR UPDATE");
            jdbcTemplate.execute("ROLLBACK");
        } catch (Exception e) {
            try { jdbcTemplate.execute("ROLLBACK"); } catch (Exception ignored) {}
            if (e.getMessage() != null && e.getMessage().toLowerCase().contains("deadlock")) {
                deadlockCount.incrementAndGet();
                deadlockCounter.increment();
                lastError = e.getMessage();
                logDeadlock();
            }
        }
    }

    private void txB() {
        try {
            jdbcTemplate.execute("START TRANSACTION");
            jdbcTemplate.execute("SELECT id FROM orders WHERE id = 2 FOR UPDATE");
            Thread.sleep(50);
            jdbcTemplate.execute("SELECT id FROM orders WHERE id = 1 FOR UPDATE");
            jdbcTemplate.execute("ROLLBACK");
        } catch (Exception e) {
            try { jdbcTemplate.execute("ROLLBACK"); } catch (Exception ignored) {}
            if (e.getMessage() != null && e.getMessage().toLowerCase().contains("deadlock")) {
                deadlockCount.incrementAndGet();
                deadlockCounter.increment();
                lastError = e.getMessage();
                logDeadlock();
            }
        }
    }

    private void logDeadlock() {
        try {
            jdbcTemplate.update(
                "INSERT INTO chaos_event_log (chaos_type, target_service, action) VALUES (?, ?, ?)",
                "DEADLOCK", "order-service", "INJECT");
        } catch (Exception ignored) {}
    }

    public boolean isEnabled() { return enabled; }
    public int getDeadlockCount() { return deadlockCount.get(); }
    public String getLastError() { return lastError; }
    public Instant getAutoDisableAt() { return autoDisableAt; }
}
