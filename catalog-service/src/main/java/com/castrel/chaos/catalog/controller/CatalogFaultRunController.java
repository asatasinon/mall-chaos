package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.service.CatalogDependencyState;
import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/internal/catalog/fault-runs")
public class CatalogFaultRunController {
    private final CatalogDependencyState dependencyState;
    private final ScenarioRunGuard runGuard;

    public CatalogFaultRunController(CatalogDependencyState dependencyState, ScenarioRunGuard runGuard) {
        this.dependencyState = dependencyState;
        this.runGuard = runGuard;
    }

    @PostMapping("/start")
    public ApiResponse<Map<String, Object>> start(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        if ("BROWSE_REPORT_SQL".equals(scenario) && "products-browse-report".equals(operation)) {
            context.validate(java.time.Instant.now());
            return ApiResponse.ok(Map.of("accepted", true, "operation", operation));
        }
        if (!"CART_CATALOG_DEPENDENCY".equals(scenario)
                || !"cart-product-validation".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported catalog scenario operation");
        }
        dependencyState.start(context, runGuard);
        return ApiResponse.ok(Map.of("accepted", true, "operation", operation));
    }

    @PostMapping("/stop")
    public ApiResponse<Map<String, Object>> stop(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        if ("BROWSE_REPORT_SQL".equals(scenario) && "products-browse-report".equals(operation)) {
            return ApiResponse.ok(Map.of("released", true, "operation", operation));
        }
        if (!"CART_CATALOG_DEPENDENCY".equals(scenario)
                || !"cart-product-validation".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported catalog scenario operation");
        }
        dependencyState.stop(context, runGuard);
        return ApiResponse.ok(Map.of("released", true, "operation", operation));
    }

    @PostMapping("/cleanup")
    public ApiResponse<Map<String, Object>> cleanup(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        if (!"CART_CATALOG_DEPENDENCY".equals(scenario)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported catalog cleanup scenario");
        }
        dependencyState.stop(context, runGuard);
        return ApiResponse.ok(Map.of("cleaned", true));
    }
}
