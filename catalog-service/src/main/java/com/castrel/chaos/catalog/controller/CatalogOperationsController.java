package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.service.CatalogDependencyState;
import com.castrel.chaos.catalog.service.ProductDetailCacheProvisioningService;
import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
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
    private final OperationRunGuard runGuard;
    private final ProductDetailCacheProvisioningService productDetailProvisioning;

    public CatalogOperationsController(CatalogDependencyState dependencyState,
                                       OperationRunGuard runGuard,
                                       ProductDetailCacheProvisioningService productDetailProvisioning) {
        this.dependencyState = dependencyState;
        this.runGuard = runGuard;
        this.productDetailProvisioning = productDetailProvisioning;
    }

    @PostMapping("/internal/catalog/reports/product-browse/prepare")
    public ApiResponse<Map<String, Object>> prepareProductBrowseReport(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext.fromHeaders(headers).validate(Instant.now());
        return ApiResponse.ok(Map.of("accepted", true, "operation", "products-browse-report"));
    }

    @PostMapping("/internal/catalog/product-details/cache/prepare")
    public ApiResponse<Map<String, Object>> prepareProductDetailCache(
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody(required = false) Map<String, Object> parameters,
            HttpServletRequest request) {
        requireOperationControl(request);
        return ApiResponse.ok(productDetailProvisioning.start(OperationRunContext.fromHeaders(headers), parameters));
    }

    @PostMapping("/internal/catalog/dependencies/cart-product-validation/prepare")
    public ApiResponse<Map<String, Object>> prepareCartProductValidation(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        dependencyState.start(OperationRunContext.fromHeaders(headers), runGuard);
        return ApiResponse.ok(Map.of("accepted", true, "operation", "cart-product-validation"));
    }

    @PostMapping("/internal/catalog/reports/product-browse/release")
    public ApiResponse<Map<String, Object>> releaseProductBrowseReport(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext.fromHeaders(headers).validateForRelease();
        return ApiResponse.ok(Map.of("released", true, "operation", "products-browse-report"));
    }

    @PostMapping("/internal/catalog/product-details/cache/release")
        public ApiResponse<Map<String, Object>> releaseProductDetailCache(
            @RequestHeader org.springframework.http.HttpHeaders headers,
            HttpServletRequest request) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        context.validateForRelease();
        requireOperationControl(request);
        return ApiResponse.ok(productDetailProvisioning.stop(context));
    }

    @PostMapping("/internal/catalog/dependencies/cart-product-validation/release")
    public ApiResponse<Map<String, Object>> releaseCartProductValidation(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        context.validateForRelease();
        dependencyState.stop(context, runGuard);
        return ApiResponse.ok(Map.of("released", true, "operation", "cart-product-validation"));
    }

    @PostMapping("/internal/catalog/reports/product-browse/cleanup")
    public ApiResponse<Map<String, Object>> cleanupProductBrowseReport(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext.fromHeaders(headers).validateForRelease();
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    @PostMapping("/internal/catalog/product-details/cache/cleanup")
    public ApiResponse<Map<String, Object>> cleanupProductDetailCache(
            @RequestHeader org.springframework.http.HttpHeaders headers,
            HttpServletRequest request) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        context.validateForCleanup();
        requireOperationControl(request);
        return ApiResponse.ok(productDetailProvisioning.cleanup(context.runId(), context.fencingToken()));
    }

    @PostMapping("/internal/catalog/dependencies/cart-product-validation/cleanup")
    public ApiResponse<Map<String, Object>> cleanupCartProductValidation(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        context.validateForRelease();
        dependencyState.stop(context, runGuard);
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    private void requireOperationControl(HttpServletRequest request) {
        Object value = request.getAttribute("castrel.allowedActions");
        if (!(value instanceof Collection<?> actions) || !actions.contains("OPERATION_CONTROL")) {
            throw new BizException("INTERNAL_AUTH_REQUIRED", "Operation control authority is required");
        }
    }

}