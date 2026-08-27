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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class PromotionLockExerciseService {
    private final JdbcTemplate jdbcTemplate;
    private final DataSource dataSource;
    private final ScenarioRunGuard runGuard;
    private volatile Long couponId;
    private volatile Long reservationId;
    private volatile String activeRunId;
    private final AtomicInteger competitionCount = new AtomicInteger();
    private final AtomicInteger deadlockVictimCount = new AtomicInteger();

    public PromotionLockExerciseService(JdbcTemplate jdbcTemplate, DataSource dataSource, ScenarioRunGuard runGuard) {
        this.jdbcTemplate = jdbcTemplate;
        this.dataSource = dataSource;
        this.runGuard = runGuard;
    }

    public synchronized void start(ScenarioRunContext context) {
        context.validate(Instant.now());
        if (!runGuard.acceptStart(context)) throw new BizException("STALE_SCENARIO_RUN", "Scenario token was rejected");
        Long preparedCoupon = jdbcTemplate.queryForObject(
                "SELECT id FROM coupons WHERE user_id = 19 ORDER BY id LIMIT 1", Long.class);
        if (preparedCoupon == null) throw new BizException("EXERCISE_PREPARATION_FAILED", "No Sam coupon is available");
        jdbcTemplate.update(
                "INSERT INTO coupon_reservations (coupon_id, order_id, customer_id, status, operation_id, expires_at) VALUES (?, ?, 19, 'RESERVED', ?, DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE))",
                preparedCoupon, context.runId(), context.idempotencyKey());
        Long preparedReservation = jdbcTemplate.queryForObject(
                "SELECT id FROM coupon_reservations WHERE order_id = ? AND operation_id = ?", Long.class,
                context.runId(), context.idempotencyKey());
        couponId = preparedCoupon;
        reservationId = preparedReservation;
        activeRunId = context.runId();
        competitionCount.set(0);
        deadlockVictimCount.set(0);
        runGuard.registerCleanup(context, () -> cleanup(context));
    }

    public synchronized Map<String, Object> check(ScenarioRunContext context) {
        context.validate(Instant.now());
        if (!context.runId().equals(activeRunId) || !runGuard.isAccepted(context)) {
            throw new BizException("EXERCISE_RUN_INACTIVE", "Exercise run is not active");
        }
        if (couponId == null || reservationId == null) throw new BizException("EXERCISE_PREPARATION_MISSING", "Prepared reservation is missing");
        competitionCount.incrementAndGet();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CyclicBarrier barrier = new CyclicBarrier(2);
        try {
            Future<Boolean> first = executor.submit(() -> lockCouponThenReservation(barrier));
            Future<Boolean> second = executor.submit(() -> lockReservationThenCoupon(barrier));
            first.get(15, TimeUnit.SECONDS);
            second.get(15, TimeUnit.SECONDS);
        } catch (Exception exception) {
            throw new BizException("EXERCISE_CONTENTION_FAILED", "Reservation consistency check failed", exception);
        } finally {
            executor.shutdownNow();
        }
        return Map.of("competitionCount", competitionCount.get(), "deadlockVictimCount", deadlockVictimCount.get(),
                "preparedReservationId", reservationId, "status", "RECOVERED");
    }

    public synchronized void stop(ScenarioRunContext context) {
        context.validateForRelease();
        runGuard.release(context);
        cleanup(context);
    }

    public synchronized void cleanup(ScenarioRunContext context) {
        if (!context.runId().equals(activeRunId)) return;
        if (reservationId != null) jdbcTemplate.update("DELETE FROM coupon_reservations WHERE id = ? AND order_id = ?", reservationId, context.runId());
        couponId = null;
        reservationId = null;
        activeRunId = null;
    }

    private boolean lockCouponThenReservation(CyclicBarrier barrier) {
        return runTransaction(barrier, true);
    }

    private boolean lockReservationThenCoupon(CyclicBarrier barrier) {
        return runTransaction(barrier, false);
    }

    private boolean runTransaction(CyclicBarrier barrier, boolean couponFirst) {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            lock(connection, couponFirst ? "SELECT id FROM coupons WHERE id = ? FOR UPDATE" : "SELECT id FROM coupon_reservations WHERE id = ? FOR UPDATE", couponFirst ? couponId : reservationId);
            barrier.await(5, TimeUnit.SECONDS);
            lock(connection, couponFirst ? "SELECT id FROM coupon_reservations WHERE id = ? FOR UPDATE" : "SELECT id FROM coupons WHERE id = ? FOR UPDATE", couponFirst ? reservationId : couponId);
            connection.rollback();
            return true;
        } catch (Exception exception) {
            if (isDeadlock(exception)) deadlockVictimCount.incrementAndGet();
            return false;
        }
    }

    private void lock(Connection connection, String sql, Long id) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setLong(1, id);
            statement.executeQuery().close();
        }
    }

    private boolean isDeadlock(Exception exception) {
        Throwable current = exception;
        while (current != null) {
            if (current instanceof SQLException sql && sql.getErrorCode() == 1213) return true;
            current = current.getCause();
        }
        return false;
    }
}
