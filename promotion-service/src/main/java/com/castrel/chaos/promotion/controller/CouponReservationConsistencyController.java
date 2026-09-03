package com.castrel.chaos.promotion.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.promotion.service.CouponReservationConsistencyService;
import org.springframework.web.bind.annotation.*;

import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.TimeoutException;

@RestController
@RequestMapping("/internal/promotion/coupons/reservations")
public class CouponReservationConsistencyController {
    private final CouponReservationConsistencyService reservationConsistencyService;

    public CouponReservationConsistencyController(CouponReservationConsistencyService reservationConsistencyService) {
        this.reservationConsistencyService = reservationConsistencyService;
    }

    @PostMapping("/prepare")
    public ApiResponse<Map<String, Object>> prepare(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        reservationConsistencyService.prepare(ScenarioRunContext.fromHeaders(headers));
        return ApiResponse.ok(Map.of("accepted", true, "operation", "coupon-reservation-consistency"));
    }

    @PostMapping("/release")
    public ApiResponse<Map<String, Object>> release(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        reservationConsistencyService.release(context);
        return ApiResponse.ok(Map.of("released", true, "runId", context.runId()));
    }

    @PostMapping("/remove")
    public ApiResponse<Map<String, Object>> remove(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        reservationConsistencyService.removePreparedReservation(context);
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    @PostMapping("/consistency")
    public ApiResponse<Map<String, Object>> consistency(
            @RequestHeader org.springframework.http.HttpHeaders headers)
            throws SQLException, InterruptedException, TimeoutException {
        return ApiResponse.ok(reservationConsistencyService.checkReservationConsistency(
                ScenarioRunContext.fromHeaders(headers)));
    }
}