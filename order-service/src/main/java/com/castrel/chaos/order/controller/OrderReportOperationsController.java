package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.coordination.OperationRunContext;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

@RestController
public class OrderReportOperationsController {

    @PostMapping("/internal/orders/reports/order-query/prepare")
    public ApiResponse<Map<String, Object>> prepareOrderQueryReport(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext.fromHeaders(headers).validate(Instant.now());
        return ApiResponse.ok(Map.of("accepted", true, "operation", "orders-query-report"));
    }

    @PostMapping("/internal/orders/reports/order-query/release")
    public ApiResponse<Map<String, Object>> releaseOrderQueryReport(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        context.validateForRelease();
        return ApiResponse.ok(Map.of("released", true, "operation", "orders-query-report"));
    }

    @PostMapping("/internal/orders/reports/order-query/cleanup")
    public ApiResponse<Map<String, Object>> cleanupOrderQueryReport(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext.fromHeaders(headers).validateForRelease();
        return ApiResponse.ok(Map.of("cleaned", true));
    }
}