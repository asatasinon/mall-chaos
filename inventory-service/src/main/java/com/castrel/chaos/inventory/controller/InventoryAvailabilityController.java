package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.inventory.service.InventoryAvailabilityService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/internal/inventory/availability")
public class InventoryAvailabilityController {
    private final InventoryAvailabilityService availabilityService;

    public InventoryAvailabilityController(InventoryAvailabilityService availabilityService) {
        this.availabilityService = availabilityService;
    }

    @PostMapping("/prepare")
    public ApiResponse<Map<String, Object>> prepare(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        availabilityService.prepare(ScenarioRunContext.fromHeaders(headers));
        return ApiResponse.ok(Map.of("accepted", true, "operation", "inventory-availability-report"));
    }

    @PostMapping("/release")
    public ApiResponse<Map<String, Object>> release(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        availabilityService.release(context);
        return ApiResponse.ok(Map.of("released", true, "runId", context.runId()));
    }

    @PostMapping("/remove")
    public ApiResponse<Map<String, Object>> remove(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        return ApiResponse.ok(availabilityService.remove(ScenarioRunContext.fromHeaders(headers)));
    }

    @PostMapping("/report")
    public ApiResponse<Map<String, Object>> report(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        return ApiResponse.ok(availabilityService.report(ScenarioRunContext.fromHeaders(headers)));
    }
}