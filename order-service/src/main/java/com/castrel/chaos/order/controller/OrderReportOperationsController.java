package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

@RestController
public class OrderReportOperationsController {

    @PostMapping("/internal/orders/reports/order-query/prepare")
    public ApiResponse<Map<String, Object>> prepareOrderQueryReport(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext.fromHeaders(headers).validate(Instant.now());
        return ApiResponse.ok(Map.of("accepted", true, "operation", operation));
    }

    @PostMapping("/internal/orders/reports/order-query/release")
    public ApiResponse<Map<String, Object>> releaseOrderQueryReport(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        return ApiResponse.ok(Map.of("released", true, "operation", operation));
    }

    @PostMapping("/internal/orders/reports/order-query/cleanup")
    public ApiResponse<Map<String, Object>> cleanupOrderQueryReport(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        if (!"ORDER_REPORT_SQL".equals(scenario)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported order cleanup operation");
        }
        ScenarioRunContext.fromHeaders(headers).validateForRelease();
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    private void requireOperation(String scenario, String operation) {
        if (!"ORDER_REPORT_SQL".equals(scenario) || !"orders-query-report".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported order operation");
        }
    }
}