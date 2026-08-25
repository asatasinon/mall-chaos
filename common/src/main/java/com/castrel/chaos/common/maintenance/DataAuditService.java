package com.castrel.chaos.common.maintenance;

import com.castrel.chaos.common.BizException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Performs a data-consistency audit on a specified table by acquiring a
 * table-level write lock. A background thread polls Redis to determine
 * when to release the lock.
 */
@Service
public class DataAuditService {

    private static final Logger log = LoggerFactory.getLogger(DataAuditService.class);
    private static final String REDIS_KEY = "castrel:maintenance:lock-audit";
    private static final int MAX_DURATION_SEC = 600;

    private static final Set<String> ALLOWED_TABLES = Set.of(
            "orders", "order_items", "payment_attempts", "inventories",
            "shipments", "customer_notifications", "risk_events", "promotions", "coupons"
    );

    private final DataSource dataSource;
    private final StringRedisTemplate redisTemplate;

    @Value("${spring.application.name:unknown}")
    private String serviceName;

    private volatile Connection lockConnection;
    private volatile boolean auditing = false;
    private volatile String lockedTable;
    private volatile Instant startedAt;
    private Thread pollThread;
    private ScheduledFuture<?> autoReleaseFuture;

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "data-audit-scheduler");
        t.setDaemon(true);
        return t;
    });

    public DataAuditService(DataSource dataSource, StringRedisTemplate redisTemplate) {
        this.dataSource = dataSource;
        this.redisTemplate = redisTemplate;
    }

    /**
     * Start a data-consistency audit on the given table (acquires WRITE lock).
     *
     * @param tableName   must be in the allowed whitelist
     * @param durationSec auto-release after this many seconds (capped at 600)
     */
    public synchronized void startAudit(String tableName, int durationSec) {
        if (auditing) {
            throw new BizException("AUDIT_ALREADY_RUNNING",
                    "A data audit is already running on table: " + lockedTable);
        }
        if (!ALLOWED_TABLES.contains(tableName)) {
            throw new BizException("INVALID_TABLE",
                    "Table not eligible for audit: " + tableName);
        }

        int safeDuration = Math.min(Math.max(durationSec, 0), MAX_DURATION_SEC);

        try {
            lockConnection = dataSource.getConnection();
            lockConnection.setAutoCommit(false);
            Statement stmt = lockConnection.createStatement();
            stmt.execute("LOCK TABLES " + tableName + " WRITE");
        } catch (SQLException e) {
            closeConnectionQuietly();
            throw new BizException("LOCK_FAILED", "Failed to lock table: " + e.getMessage(), e);
        }

        auditing = true;
        lockedTable = tableName;
        startedAt = Instant.now();

        // Background poll: check Redis to see if audit should stop
        pollThread = new Thread(() -> {
            while (auditing) {
                try {
                    Thread.sleep(2_000);
                    Object active = redisTemplate.opsForHash().get(REDIS_KEY, "active");
                    if (!"true".equals(active)) {
                        stopAudit();
                        return;
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                } catch (Exception e) {
                    log.debug("Redis poll failed during data audit, continuing", e);
                }
            }
        }, "data-audit-poll");
        pollThread.setDaemon(true);
        pollThread.start();

        // Auto-release timer
        if (safeDuration > 0) {
            autoReleaseFuture = scheduler.schedule(this::stopAudit, safeDuration, TimeUnit.SECONDS);
        }

        log.info("Data audit started: table={}, durationSec={}", tableName, safeDuration);
    }

    /** Stop the audit and release the table lock. */
    public synchronized void stopAudit() {
        if (!auditing) return;
        auditing = false;

        if (autoReleaseFuture != null) {
            autoReleaseFuture.cancel(false);
            autoReleaseFuture = null;
        }

        try {
            if (lockConnection != null && !lockConnection.isClosed()) {
                Statement stmt = lockConnection.createStatement();
                stmt.execute("UNLOCK TABLES");
            }
        } catch (SQLException e) {
            log.warn("Failed to unlock tables", e);
        }
        closeConnectionQuietly();

        // Update Redis
        try {
            redisTemplate.opsForHash().put(REDIS_KEY, "active", "false");
        } catch (Exception e) {
            log.debug("Failed to update Redis after audit stop", e);
        }

        log.info("Data audit stopped: table={}, duration={}", lockedTable,
                startedAt != null ? Duration.between(startedAt, Instant.now()) : "N/A");
    }

    /** Returns the current audit status. */
    public DataAuditStatus getStatus() {
        if (!auditing) {
            return new DataAuditStatus(false, null, "IDLE", null, null);
        }
        String holdingDuration = startedAt != null
                ? Duration.between(startedAt, Instant.now()).toString()
                : null;
        return new DataAuditStatus(
                true,
                lockedTable,
                "RUNNING",
                startedAt != null ? startedAt.toString() : null,
                holdingDuration
        );
    }

    private void closeConnectionQuietly() {
        try {
            if (lockConnection != null && !lockConnection.isClosed()) {
                lockConnection.close();
            }
        } catch (SQLException e) {
            log.warn("Failed to close audit connection", e);
        }
        lockConnection = null;
    }
}
