package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.service.CatalogDependencyState;
import com.castrel.chaos.catalog.service.ProductDetailCacheProvisioningService;
import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Collection;
import java.util.Map;

@RestController
@RequestMapping("/internal/catalog/fault-runs")
public class CatalogFaultRunController {
    private final CatalogDependencyState dependencyState;
    private final ScenarioRunGuard runGuard;
    private final ProductDetailCacheProvisioningService productDetailProvisioning;

    public CatalogFaultRunController(CatalogDependencyState dependencyState,
                                     ScenarioRunGuard runGuard,
                                     ProductDetailCacheProvisioningService productDetailProvisioning) {
        this.dependencyState = dependencyState;
        this.runGuard = runGuard;
        this.productDetailProvisioning = productDetailProvisioning;
    }

    @PostMapping("/start")
    public ApiResponse<Map<String, Object>> start(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody(required = false) Map<String, Object> parameters,
            HttpServletRequest request) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        if (ProductDetailCacheProvisioningService.SCENARIO.equals(scenario)
                && ProductDetailCacheProvisioningService.OPERATION.equals(operation)) {
            requireFaultRunControl(request);
            return ApiResponse.ok(productDetailProvisioning.start(context, parameters));
        }
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
            @RequestHeader org.springframework.http.HttpHeaders headers,
            HttpServletRequest request) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        if (ProductDetailCacheProvisioningService.SCENARIO.equals(scenario)
                && ProductDetailCacheProvisioningService.OPERATION.equals(operation)) {
            requireFaultRunControl(request);
            return ApiResponse.ok(productDetailProvisioning.stop(context));
        }
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
            @RequestHeader org.springframework.http.HttpHeaders headers,
            HttpServletRequest request) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        if (ProductDetailCacheProvisioningService.SCENARIO.equals(scenario)) {
            requireFaultRunControl(request);
            context.validateForCleanup();
            return ApiResponse.ok(productDetailProvisioning.cleanup(context.runId(), context.fencingToken()));
        }
        context.validateForRelease();
        if (!"CART_CATALOG_DEPENDENCY".equals(scenario)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported catalog cleanup scenario");
        }
        dependencyState.stop(context, runGuard);
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    private void requireFaultRunControl(HttpServletRequest request) {
        Object value = request.getAttribute("castrel.allowedActions");
        if (!(value instanceof Collection<?> actions) || !actions.contains("FAULT_RUN_CONTROL")) {
            throw new BizException("INTERNAL_AUTH_REQUIRED", "Fault Run control authority is required");
        }
    }
}
