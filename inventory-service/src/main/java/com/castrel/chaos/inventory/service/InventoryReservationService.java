package com.castrel.chaos.inventory.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Map;

@Service
public class InventoryReservationService {
    private static final String SKU = "SKU-001";
    private static final String SUMMARY_SQL = "SELECT sku, available_qty, reserved_qty, version "
            + "FROM inventories WHERE sku = ? FOR UPDATE";

    private final DataSource dataSource;
    private final OperationRunGuard runGuard;
    private volatile Connection reservationConnection;
    private volatile String activeRunId;
    private volatile long fencingToken;

    public InventoryReservationService(DataSource dataSource, OperationRunGuard runGuard) {
        this.dataSource = dataSource;
        this.runGuard = runGuard;
    }

    public synchronized void prepare(OperationRunContext context) {
        context.validate(Instant.now());
        if (!runGuard.acceptStart(context)) throw new BizException("STALE_OPERATION", "Operation token was rejected");
        if (context.runId().equals(activeRunId) && fencingToken == context.fencingToken()) return;
        if (reservationConnection != null) {
            throw new BizException("INVENTORY_RESERVATION_ALREADY_ACTIVE", "Inventory reservation is already active");
        }
        try {
            Connection connection = dataSource.getConnection();
            reservationConnection = connection;
            connection.setAutoCommit(false);
            try (PreparedStatement statement = connection.prepareStatement(SUMMARY_SQL)) {
                statement.setString(1, SKU);
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) throw new BizException("SKU_NOT_FOUND", "SKU not found: " + SKU);
                }
            }
            activeRunId = context.runId();
            fencingToken = context.fencingToken();
            runGuard.registerCleanup(context, () -> closeResource(context));
        } catch (BizException exception) {
            closeConnection();
            runGuard.release(context);
            throw exception;
        } catch (Exception exception) {
            closeConnection();
            runGuard.release(context);
            throw new BizException("INVENTORY_RESERVATION_PREPARE_FAILED", "Could not prepare inventory reservation", exception);
        }
    }

    public Map<String, Object> summary(OperationRunContext context) {
        context.validate(Instant.now());
        if (!context.runId().equals(activeRunId) || fencingToken != context.fencingToken()
                || !runGuard.isAccepted(context)) {
            throw new BizException("INVENTORY_RESERVATION_INACTIVE", "Inventory reservation is not active");
        }
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try (PreparedStatement statement = connection.prepareStatement(SUMMARY_SQL)) {
                statement.setString(1, SKU);
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) throw new BizException("SKU_NOT_FOUND", "SKU not found: " + SKU);
                    Map<String, Object> summary = Map.of(
                            "sku", result.getString("sku"),
                            "availableQty", result.getInt("available_qty"),
                            "reservedQty", result.getInt("reserved_qty"),
                            "version", result.getInt("version"),
                            "runId", context.runId());
                    connection.rollback();
                    return summary;
                }
            }
        } catch (BizException exception) {
            throw exception;
        } catch (SQLException exception) {
            throw new BizException("INVENTORY_RESERVATION_READ_FAILED", "Could not read inventory reservation", exception);
        }
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
            if (reservationConnection != null && !reservationConnection.isClosed()) {
                reservationConnection.rollback();
            }
        } catch (Exception exception) {
            throw new BizException("INVENTORY_RESERVATION_RELEASE_FAILED", "Could not release inventory reservation", exception);
        } finally {
            closeConnection();
            activeRunId = null;
            fencingToken = 0;
        }
        return Map.of("released", true, "runId", context.runId());
    }

    private void closeConnection() {
        try {
            if (reservationConnection != null) reservationConnection.close();
        } catch (Exception ignored) {
        } finally {
            reservationConnection = null;
        }
    }
}