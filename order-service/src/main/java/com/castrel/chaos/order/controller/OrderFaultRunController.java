package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/internal/orders/fault-runs")
public class OrderFaultRunController {

    @PostMapping("/start")
    public ApiResponse<Map<String, Object>> start(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext.fromHeaders(headers).validate(Instant.now());
        return ApiResponse.ok(Map.of("accepted", true, "operation", operation));
    }

    @PostMapping("/stop")
    public ApiResponse<Map<String, Object>> stop(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        return ApiResponse.ok(Map.of("released", true, "faultRunId", context.runId()));
    }

    @PostMapping("/cleanup")
    public ApiResponse<Map<String, Object>> cleanup(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, "orders-query-report");
        ScenarioRunContext.fromHeaders(headers).validateForRelease();
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    private void requireOperation(String scenario, String operation) {
        if (!"ORDER_REPORT_SQL".equals(scenario) || !"orders-query-report".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported order scenario operation");
        }
    }
}