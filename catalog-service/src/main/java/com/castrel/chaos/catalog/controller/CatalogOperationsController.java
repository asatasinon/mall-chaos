package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.service.CatalogDependencyState;
import com.castrel.chaos.catalog.service.ProductDetailCacheProvisioningService;
import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;

@RestController
public class CatalogOperationsController {
    private final CatalogDependencyState dependencyState;
    private final ScenarioRunGuard runGuard;
    private final ProductDetailCacheProvisioningService productDetailProvisioning;

    public CatalogOperationsController(CatalogDependencyState dependencyState,
                                       ScenarioRunGuard runGuard,
                                       ProductDetailCacheProvisioningService productDetailProvisioning) {
        this.dependencyState = dependencyState;
        this.runGuard = runGuard;
        this.productDetailProvisioning = productDetailProvisioning;
    }

    @PostMapping("/internal/catalog/reports/product-browse/prepare")
    public ApiResponse<Map<String, Object>> prepareProductBrowseReport(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation, "BROWSE_REPORT_SQL", "products-browse-report");
        ScenarioRunContext.fromHeaders(headers).validate(Instant.now());
        return ApiResponse.ok(Map.of("accepted", true, "operation", operation));
    }

    @PostMapping("/internal/catalog/product-details/cache/prepare")
    public ApiResponse<Map<String, Object>> prepareProductDetailCache(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody(required = false) Map<String, Object> parameters,
            HttpServletRequest request) {
        requireOperation(scenario, operation, ProductDetailCacheProvisioningService.SCENARIO,
                ProductDetailCacheProvisioningService.OPERATION);
        requireScenarioControl(request);
        return ApiResponse.ok(productDetailProvisioning.start(ScenarioRunContext.fromHeaders(headers), parameters));
    }

    @PostMapping("/internal/catalog/dependencies/cart-product-validation/prepare")
    public ApiResponse<Map<String, Object>> prepareCartProductValidation(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation, "CART_CATALOG_DEPENDENCY", "cart-product-validation");
        dependencyState.start(ScenarioRunContext.fromHeaders(headers), runGuard);
        return ApiResponse.ok(Map.of("accepted", true, "operation", operation));
    }

    @PostMapping("/internal/catalog/reports/product-browse/release")
    public ApiResponse<Map<String, Object>> releaseProductBrowseReport(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation, "BROWSE_REPORT_SQL", "products-browse-report");
        ScenarioRunContext.fromHeaders(headers).validateForRelease();
        return ApiResponse.ok(Map.of("released", true, "operation", operation));
    }

    @PostMapping("/internal/catalog/product-details/cache/release")
    public ApiResponse<Map<String, Object>> releaseProductDetailCache(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers,
            HttpServletRequest request) {
        requireOperation(scenario, operation, ProductDetailCacheProvisioningService.SCENARIO,
                ProductDetailCacheProvisioningService.OPERATION);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        requireScenarioControl(request);
        return ApiResponse.ok(productDetailProvisioning.stop(context));
    }

    @PostMapping("/internal/catalog/dependencies/cart-product-validation/release")
    public ApiResponse<Map<String, Object>> releaseCartProductValidation(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation, "CART_CATALOG_DEPENDENCY", "cart-product-validation");
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        dependencyState.stop(context, runGuard);
        return ApiResponse.ok(Map.of("released", true, "operation", operation));
    }

    @PostMapping("/internal/catalog/reports/product-browse/cleanup")
    public ApiResponse<Map<String, Object>> cleanupProductBrowseReport(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireScenario(scenario, "BROWSE_REPORT_SQL");
        ScenarioRunContext.fromHeaders(headers).validateForRelease();
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    @PostMapping("/internal/catalog/product-details/cache/cleanup")
    public ApiResponse<Map<String, Object>> cleanupProductDetailCache(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers,
            HttpServletRequest request) {
        if (!ProductDetailCacheProvisioningService.SCENARIO.equals(scenario)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported catalog cleanup operation");
        }
        requireScenarioControl(request);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForCleanup();
        return ApiResponse.ok(productDetailProvisioning.cleanup(context.runId(), context.fencingToken()));
    }

    @PostMapping("/internal/catalog/dependencies/cart-product-validation/cleanup")
    public ApiResponse<Map<String, Object>> cleanupCartProductValidation(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireScenario(scenario, "CART_CATALOG_DEPENDENCY");
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        dependencyState.stop(context, runGuard);
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    private void requireScenarioControl(HttpServletRequest request) {
        Object value = request.getAttribute("castrel.allowedActions");
        if (!(value instanceof Collection<?> actions) || !actions.contains("SCENARIO_CONTROL")) {
            throw new BizException("INTERNAL_AUTH_REQUIRED", "Scenario control authority is required");
        }
    }

    private void requireOperation(String scenario, String operation,
                                  String expectedScenario, String expectedOperation) {
        if (!expectedScenario.equals(scenario) || !expectedOperation.equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported catalog operation");
        }
    }

    private void requireScenario(String scenario, String expectedScenario) {
        if (!expectedScenario.equals(scenario)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported catalog cleanup operation");
        }
    }
}