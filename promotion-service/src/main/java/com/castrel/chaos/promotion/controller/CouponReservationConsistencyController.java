package com.castrel.chaos.promotion.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.promotion.service.CouponReservationConsistencyService;
import org.springframework.web.bind.annotation.*;

import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.TimeoutException;

@RestController
@RequestMapping("/internal/promotion")
public class CouponReservationConsistencyController {
    private final CouponReservationConsistencyService reservationConsistencyService;

    public CouponReservationConsistencyController(CouponReservationConsistencyService reservationConsistencyService) {
        this.reservationConsistencyService = reservationConsistencyService;
    }

    @PostMapping("/fault-runs/start")
    public ApiResponse<Map<String, Object>> startConsistency(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        reservationConsistencyService.prepare(ScenarioRunContext.fromHeaders(headers));
        return ApiResponse.ok(Map.of("accepted", true, "operation", operation));
    }

    @PostMapping("/fault-runs/stop")
    public ApiResponse<Map<String, Object>> stopConsistency(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        reservationConsistencyService.release(context);
        return ApiResponse.ok(Map.of("released", true, "faultRunId", context.runId()));
    }

    @PostMapping("/fault-runs/cleanup")
    public ApiResponse<Map<String, Object>> cleanupConsistency(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        if (!"PROMOTION_LOCK_CONTENTION".equals(scenario)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported promotion scenario");
        }
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        reservationConsistencyService.removePreparedReservation(context);
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    @PostMapping("/consistency")
    public ApiResponse<Map<String, Object>> checkReservationConsistency(
            @RequestHeader org.springframework.http.HttpHeaders headers)
            throws SQLException, InterruptedException, TimeoutException {
        return ApiResponse.ok(reservationConsistencyService.checkReservationConsistency(
                ScenarioRunContext.fromHeaders(headers)));
    }

    private void requireOperation(String scenario, String operation) {
        if (!"PROMOTION_LOCK_CONTENTION".equals(scenario)
                || !"coupon-reservation-consistency".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported promotion scenario operation");
        }
    }
}