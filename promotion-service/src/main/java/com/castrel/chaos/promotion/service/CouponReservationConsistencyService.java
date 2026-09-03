package com.castrel.chaos.promotion.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Service
public class CouponReservationConsistencyService {
    private final JdbcTemplate jdbcTemplate;
    private final DataSource dataSource;
    private final ScenarioRunGuard runGuard;
    private volatile Long couponId;
    private volatile Long reservationId;
    private volatile String activeRunId;

    public CouponReservationConsistencyService(JdbcTemplate jdbcTemplate, DataSource dataSource,
                                               ScenarioRunGuard runGuard) {
        this.jdbcTemplate = jdbcTemplate;
        this.dataSource = dataSource;
        this.runGuard = runGuard;
    }

    public synchronized void prepare(ScenarioRunContext context) {
        context.validate(Instant.now());
        if (!runGuard.acceptStart(context)) throw new BizException("STALE_OPERATION", "Operation token was rejected");
        Long preparedCoupon = jdbcTemplate.queryForObject(
                "SELECT id FROM coupons WHERE user_id = 19 ORDER BY id LIMIT 1", Long.class);
        if (preparedCoupon == null) throw new BizException("RESERVATION_PREPARATION_FAILED", "No Sam coupon is available");
        jdbcTemplate.update(
                "INSERT INTO coupon_reservations (coupon_id, order_id, customer_id, status, operation_id, expires_at) VALUES (?, ?, 19, 'RESERVED', ?, DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE))",
                preparedCoupon, context.runId(), context.idempotencyKey());
        Long preparedReservation = jdbcTemplate.queryForObject(
                "SELECT id FROM coupon_reservations WHERE order_id = ? AND operation_id = ?", Long.class,
                context.runId(), context.idempotencyKey());
        couponId = preparedCoupon;
        reservationId = preparedReservation;
        activeRunId = context.runId();
        runGuard.registerCleanup(context, () -> removePreparedReservation(context));
    }

    public synchronized Map<String, Object> checkReservationConsistency(ScenarioRunContext context)
            throws SQLException, InterruptedException, TimeoutException {
        context.validate(Instant.now());
        if (!context.runId().equals(activeRunId) || !runGuard.isAccepted(context)) {
            throw new BizException("RESERVATION_RUN_INACTIVE", "Reservation consistency run is not active");
        }
        if (couponId == null || reservationId == null) {
            throw new BizException("RESERVATION_PREPARATION_MISSING", "Prepared reservation is missing");
        }
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CyclicBarrier barrier = new CyclicBarrier(2);
        try {
            Future<?> couponFirst = executor.submit(() -> {
                lockCouponThenReservation(barrier);
                return null;
            });
            Future<?> reservationFirst = executor.submit(() -> {
                lockReservationThenCoupon(barrier);
                return null;
            });
            await(couponFirst);
            await(reservationFirst);
        } finally {
            executor.shutdownNow();
        }
        return Map.of("status", "CONSISTENT");
    }

    public synchronized void release(ScenarioRunContext context) {
        context.validateForRelease();
        runGuard.release(context);
        removePreparedReservation(context);
    }

    public synchronized void removePreparedReservation(ScenarioRunContext context) {
        context.validateForCleanup();
        if (!context.runId().equals(activeRunId)) return;
        if (reservationId != null) {
            jdbcTemplate.update("DELETE FROM coupon_reservations WHERE id = ? AND order_id = ?",
                    reservationId, context.runId());
        }
        couponId = null;
        reservationId = null;
        activeRunId = null;
    }

    private void lockCouponThenReservation(CyclicBarrier barrier) throws Exception {
        runConsistencyTransaction(barrier, true);
    }

    private void lockReservationThenCoupon(CyclicBarrier barrier) throws Exception {
        runConsistencyTransaction(barrier, false);
    }

    private void runConsistencyTransaction(CyclicBarrier barrier, boolean lockCouponFirst) throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            lockRow(connection,
                    lockCouponFirst ? "SELECT id FROM coupons WHERE id = ? FOR UPDATE"
                            : "SELECT id FROM coupon_reservations WHERE id = ? FOR UPDATE",
                    lockCouponFirst ? couponId : reservationId);
            barrier.await(5, TimeUnit.SECONDS);
            lockRow(connection,
                    lockCouponFirst ? "SELECT id FROM coupon_reservations WHERE id = ? FOR UPDATE"
                            : "SELECT id FROM coupons WHERE id = ? FOR UPDATE",
                    lockCouponFirst ? reservationId : couponId);
            connection.rollback();
        }
    }

    private void await(Future<?> transaction) throws SQLException, InterruptedException, TimeoutException {
        try {
            transaction.get(15, TimeUnit.SECONDS);
        } catch (ExecutionException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof SQLException sqlException) throw sqlException;
            if (cause instanceof RuntimeException runtimeException) throw runtimeException;
            if (cause instanceof Error error) throw error;
            throw new IllegalStateException(cause);
        }
    }

    private void lockRow(Connection connection, String sql, Long id) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setLong(1, id);
            statement.executeQuery().close();
        }
    }
}