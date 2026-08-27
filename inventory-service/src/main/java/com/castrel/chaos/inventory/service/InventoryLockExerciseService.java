package com.castrel.chaos.inventory.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class InventoryLockExerciseService {
    private static final List<String> REPORT_SKUS = List.of("SKU-001", "SKU-002", "SKU-003", "SKU-004", "SKU-005");

    private final DataSource dataSource;
    private final JdbcTemplate jdbcTemplate;
    private final ScenarioRunGuard runGuard;
    private volatile Connection lockConnection;
    private volatile String activeRunId;
    private volatile long fencingToken;

    public InventoryLockExerciseService(DataSource dataSource, JdbcTemplate jdbcTemplate, ScenarioRunGuard runGuard) {
        this.dataSource = dataSource;
        this.jdbcTemplate = jdbcTemplate;
        this.runGuard = runGuard;
    }

    public synchronized void start(ScenarioRunContext context) {
        context.validate(Instant.now());
        if (!runGuard.acceptStart(context)) throw new BizException("STALE_SCENARIO_RUN", "Scenario token was rejected");
        if (context.runId().equals(activeRunId) && fencingToken == context.fencingToken()) return;
        if (lockConnection != null) throw new BizException("INVENTORY_LOCK_ALREADY_ACTIVE", "Inventory lock is already active");
        try {
            Connection connection = dataSource.getConnection();
            connection.setAutoCommit(true);
            try (PreparedStatement statement = connection.prepareStatement("LOCK TABLES inventories WRITE")) {
                statement.execute();
            }
            lockConnection = connection;
            activeRunId = context.runId();
            fencingToken = context.fencingToken();
            runGuard.registerCleanup(context, () -> release(context));
        } catch (Exception exception) {
            closeConnection();
            throw new BizException("INVENTORY_LOCK_START_FAILED", "Could not acquire inventory table lock", exception);
        }
    }

    public synchronized Map<String, Object> report(ScenarioRunContext context) {
        context.validate(Instant.now());
        if (!context.runId().equals(activeRunId) || fencingToken != context.fencingToken()
                || !runGuard.isAccepted(context)) {
            throw new BizException("EXERCISE_RUN_INACTIVE", "Inventory lock run is not active");
        }
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT sku, available_qty, reserved_qty, version FROM inventories WHERE sku IN (?, ?, ?, ?, ?) ORDER BY sku",
                REPORT_SKUS.toArray());
        return Map.of("rows", rows, "skuCount", rows.size(), "runId", context.runId());
    }

    public synchronized void stop(ScenarioRunContext context) {
        context.validateForRelease();
        runGuard.release(context);
        release(context);
    }

    public synchronized Map<String, Object> release(ScenarioRunContext context) {
        if (activeRunId == null || !activeRunId.equals(context.runId())) return Map.of("released", true);
        try {
            if (lockConnection != null && !lockConnection.isClosed()) {
                try (PreparedStatement statement = lockConnection.prepareStatement("UNLOCK TABLES")) {
                    statement.execute();
                }
            }
        } catch (Exception exception) {
            throw new BizException("INVENTORY_LOCK_RELEASE_FAILED", "Could not release inventory table lock", exception);
        } finally {
            closeConnection();
            activeRunId = null;
            fencingToken = 0;
        }
        return Map.of("released", true, "runId", context.runId());
    }

    private void closeConnection() {
        try {
            if (lockConnection != null) lockConnection.close();
        } catch (Exception ignored) {
            // The connection is being discarded after the release attempt.
        } finally {
            lockConnection = null;
        }
    }
}
