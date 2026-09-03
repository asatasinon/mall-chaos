package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.inventory.service.InventoryReservationService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/internal/inventory/reservations")
public class InventoryReservationController {
    private final InventoryReservationService reservationService;

    public InventoryReservationController(InventoryReservationService reservationService) {
        this.reservationService = reservationService;
    }

    @PostMapping("/prepare")
    public ApiResponse<Map<String, Object>> prepare(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        reservationService.prepare(OperationRunContext.fromHeaders(headers));
        return ApiResponse.ok(Map.of("accepted", true, "operation", "inventory-reservation-summary"));
    }

    @PostMapping("/release")
    public ApiResponse<Map<String, Object>> release(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        reservationService.release(context);
        return ApiResponse.ok(Map.of("released", true, "runId", context.runId()));
    }

    @PostMapping("/remove")
    public ApiResponse<Map<String, Object>> remove(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        return ApiResponse.ok(reservationService.remove(OperationRunContext.fromHeaders(headers)));
    }

    @PostMapping("/summary")
    public ApiResponse<Map<String, Object>> summary(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        return ApiResponse.ok(reservationService.summary(OperationRunContext.fromHeaders(headers)));
    }
}