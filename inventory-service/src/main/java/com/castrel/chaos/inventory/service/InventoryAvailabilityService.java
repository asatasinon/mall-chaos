package com.castrel.chaos.inventory.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class InventoryAvailabilityService {
    private static final List<String> REPORT_SKUS = List.of("SKU-001", "SKU-002", "SKU-003", "SKU-004", "SKU-005");

    private final DataSource dataSource;
    private final JdbcTemplate jdbcTemplate;
    private final OperationRunGuard runGuard;
    private volatile Connection availabilityConnection;
    private volatile String activeRunId;
    private volatile long fencingToken;

    public InventoryAvailabilityService(DataSource dataSource, JdbcTemplate jdbcTemplate, OperationRunGuard runGuard) {
        this.dataSource = dataSource;
        this.jdbcTemplate = jdbcTemplate;
        this.runGuard = runGuard;
    }

    public synchronized void prepare(OperationRunContext context) {
        context.validate(Instant.now());
        if (!runGuard.acceptStart(context)) throw new BizException("STALE_OPERATION", "Operation token was rejected");
        if (context.runId().equals(activeRunId) && fencingToken == context.fencingToken()) return;
        if (availabilityConnection != null) {
            throw new BizException("INVENTORY_AVAILABILITY_ALREADY_ACTIVE", "Inventory availability is already active");
        }
        try {
            Connection connection = dataSource.getConnection();
            availabilityConnection = connection;
            connection.setAutoCommit(true);
            try (PreparedStatement statement = connection.prepareStatement("LOCK TABLES inventories WRITE")) {
                statement.execute();
            }
            activeRunId = context.runId();
            fencingToken = context.fencingToken();
            runGuard.registerCleanup(context, () -> closeResource(context));
        } catch (Exception exception) {
            closeConnection();
            throw new BizException("INVENTORY_AVAILABILITY_PREPARE_FAILED", "Could not prepare inventory availability", exception);
        }
    }

    public Map<String, Object> report(OperationRunContext context) {
        context.validate(Instant.now());
        if (!context.runId().equals(activeRunId) || fencingToken != context.fencingToken()
                || !runGuard.isAccepted(context)) {
            throw new BizException("INVENTORY_AVAILABILITY_INACTIVE", "Inventory availability is not active");
        }
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT sku, available_qty, reserved_qty, version FROM inventories WHERE sku IN (?, ?, ?, ?, ?) ORDER BY sku",
                REPORT_SKUS.toArray());
        return Map.of("rows", rows, "skuCount", rows.size(), "runId", context.runId());
    }

    public synchronized void release(OperationRunContext context) {
        context.validateForRelease();
        runGuard.release(context);
        closeResource(context);
    }

    public synchronized Map<String, Object> remove(OperationRunContext context) {
        context.validateForCleanup();
        runGuard.release(context);
        return closeResource(context);
    }

    private synchronized Map<String, Object> closeResource(OperationRunContext context) {
        if (activeRunId == null || !activeRunId.equals(context.runId())) return Map.of("released", true);
        try {
            if (availabilityConnection != null && !availabilityConnection.isClosed()) {
                try (PreparedStatement statement = availabilityConnection.prepareStatement("UNLOCK TABLES")) {
                    statement.execute();
                }
            }
        } catch (Exception exception) {
            throw new BizException("INVENTORY_AVAILABILITY_RELEASE_FAILED", "Could not release inventory availability", exception);
        } finally {
            closeConnection();
            activeRunId = null;
            fencingToken = 0;
        }
        return Map.of("released", true, "runId", context.runId());
    }

    private void closeConnection() {
        try {
            if (availabilityConnection != null) availabilityConnection.close();
        } catch (Exception ignored) {
        } finally {
            availabilityConnection = null;
        }
    }
}