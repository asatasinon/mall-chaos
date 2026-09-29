package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.service.CatalogDependencyState;
import com.castrel.chaos.catalog.service.ProductDetailCacheProvisioningService;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.Arrays;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CatalogOperationsControllerTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
        private static final String OPERATION = "product-detail-cache";

    @Mock
    private CatalogDependencyState dependencyState;

    @Mock
        private OperationRunGuard runGuard;

    @Mock
    private ProductDetailCacheProvisioningService provisioningService;

    private CatalogOperationsController controller;
    private HttpHeaders headers;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        controller = new CatalogOperationsController(dependencyState, runGuard, provisioningService);
        headers = new HttpHeaders();
        headers.set("X-Operation-Run-Id", RUN_ID);
        headers.set("X-Operation-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Operation-Run-Fencing-Token", "7");
        headers.set("X-Operation-Run-Idempotency-Key", "phase-d-controller-001");
        request = new MockHttpServletRequest();
        request.setAttribute("castrel.allowedActions", List.of("OPERATION_CONTROL"));
    }

    @Test
    void routesProductDetailCachePreparationWithParameters() {
        Map<String, Object> parameters = Map.of("durationSec", 30, "memberCount", 2);
        when(provisioningService.start(
                eq(new OperationRunContext(RUN_ID, Instant.parse(headers.getFirst("X-Operation-Run-Expires-At")), 7,
                        "phase-d-controller-001")), eq(parameters)))
                .thenReturn(Map.of("accepted", true, "layout", "HASH"));

        var response = controller.prepareProductDetailCache(headers, parameters, request);

        assertThat(response.getData()).containsEntry("accepted", true);
        verify(provisioningService).start(
                eq(new OperationRunContext(RUN_ID, Instant.parse(headers.getFirst("X-Operation-Run-Expires-At")), 7,
                        "phase-d-controller-001")), eq(parameters));
    }

    @Test
    void rejectsProductDetailPreparationWithoutControlScope() {
        request.removeAttribute("castrel.allowedActions");

        assertThatThrownBy(() -> controller.prepareProductDetailCache(headers, Map.of(), request))
                .isInstanceOf(BizException.class)
                .extracting("errorCode")
                .isEqualTo("INTERNAL_AUTH_REQUIRED");
    }

    @Test
    void routesProductDetailReleaseAndCleanup() {
        var context = new OperationRunContext(
            RUN_ID, Instant.parse(headers.getFirst("X-Operation-Run-Expires-At")), 7,
                "phase-d-controller-001");
        when(provisioningService.stop(context)).thenReturn(Map.of("released", true));
        when(provisioningService.cleanup(context)).thenReturn(Map.of("hashRemoved", true));

        var releaseResponse = controller.releaseProductDetailCache(headers, request);
        var cleanupResponse = controller.cleanupProductDetailCache(headers, request);

        assertThat(releaseResponse.getData()).containsEntry("released", true);
        assertThat(cleanupResponse.getData()).containsEntry("hashRemoved", true);
        verify(provisioningService).stop(context);
        verify(provisioningService).cleanup(context);
    }

    @Test
    void allowsProductDetailCleanupWithMinimalGatewayHeaders() {
        HttpHeaders cleanupHeaders = new HttpHeaders();
        cleanupHeaders.set("X-Operation-Run-Id", RUN_ID);
        cleanupHeaders.set("X-Operation-Run-Fencing-Token", "7");
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);
        when(provisioningService.cleanup(cleanupContext)).thenReturn(Map.of(
                "released", true, "hashRemoved", false));

        var response = controller.cleanupProductDetailCache(cleanupHeaders, request);

        assertThat(response.getData()).containsEntry("released", true);
        verify(provisioningService).cleanup(cleanupContext);
    }

    @Test
    void exposesFixedPrepareReleaseAndCleanupRoutesForCatalogOperations() {
        assertThat(postRoutes(CatalogOperationsController.class)).contains(
                "/internal/catalog/reports/product-browse/prepare",
                "/internal/catalog/reports/product-browse/release",
                "/internal/catalog/reports/product-browse/cleanup",
                "/internal/catalog/product-details/cache/prepare",
                "/internal/catalog/product-details/cache/release",
                "/internal/catalog/product-details/cache/cleanup",
                "/internal/catalog/dependencies/cart-product-validation/prepare",
                "/internal/catalog/dependencies/cart-product-validation/release",
                "/internal/catalog/dependencies/cart-product-validation/cleanup");
    }

    @Test
    void reportAndCartOperationsUseExpectedContextAndEnvelope() {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);

        var browsePrepare = controller.prepareProductBrowseReport(headers);
        var cartPrepare = controller.prepareCartProductValidation(headers);
        var browseRelease = controller.releaseProductBrowseReport(headers);
        var cartRelease = controller.releaseCartProductValidation(headers);

        assertEnvelope(browsePrepare.getCode(), browsePrepare.getMessage());
        assertThat(browsePrepare.getData())
                .containsEntry("accepted", true)
                .containsEntry("operation", "products-browse-report");
        assertEnvelope(cartPrepare.getCode(), cartPrepare.getMessage());
        assertThat(cartPrepare.getData())
                .containsEntry("accepted", true)
                .containsEntry("operation", "cart-product-validation");
        assertEnvelope(browseRelease.getCode(), browseRelease.getMessage());
        assertThat(browseRelease.getData())
                .containsEntry("released", true)
                .containsEntry("operation", "products-browse-report");
        assertEnvelope(cartRelease.getCode(), cartRelease.getMessage());
        verify(dependencyState).start(context, runGuard);
        verify(dependencyState).stop(context, runGuard);
    }

    @Test
    void catalogCleanupAcceptsGatewayMinimalRunContext() {
        HttpHeaders cleanupHeaders = new HttpHeaders();
        cleanupHeaders.set("X-Operation-Run-Id", RUN_ID);
        cleanupHeaders.set("X-Operation-Run-Fencing-Token", "7");
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);

        var browseResponse = controller.cleanupProductBrowseReport(cleanupHeaders);
        var cartResponse = controller.cleanupCartProductValidation(cleanupHeaders);

        assertEnvelope(browseResponse.getCode(), browseResponse.getMessage());
        assertThat(browseResponse.getData()).containsEntry("cleaned", true);
        assertEnvelope(cartResponse.getCode(), cartResponse.getMessage());
        assertThat(cartResponse.getData()).containsEntry("cleaned", true);
        verify(dependencyState).stopForCleanup(cleanupContext, runGuard);
    }

    @Test
    void actualCartCleanupValidatesMinimalContextBeforeReleasingTheFence() {
        OperationRunGuard guard = mock(OperationRunGuard.class);
        var realController = new CatalogOperationsController(
                new CatalogDependencyState(), guard, provisioningService);
        HttpHeaders cleanupHeaders = new HttpHeaders();
        cleanupHeaders.set("X-Operation-Run-Id", RUN_ID);
        cleanupHeaders.set("X-Operation-Run-Fencing-Token", "7");
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);

        var response = realController.cleanupCartProductValidation(cleanupHeaders);

        assertEnvelope(response.getCode(), response.getMessage());
        assertThat(response.getData()).containsEntry("cleaned", true);
        verify(guard).release(cleanupContext);

        HttpHeaders invalidContext = new HttpHeaders();
        invalidContext.set("X-Operation-Run-Id", RUN_ID);
        assertThatThrownBy(() -> realController.cleanupCartProductValidation(invalidContext))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation cleanup context");
        verifyNoMoreInteractions(guard);
    }

    @Test
    void prepareRejectsMissingOperationContextBeforeReturningAccepted() {
        HttpHeaders missingContext = new HttpHeaders();
        missingContext.set("X-Operation-Run-Id", RUN_ID);
        missingContext.set("X-Operation-Run-Fencing-Token", "7");

        assertThatThrownBy(() -> controller.prepareProductBrowseReport(missingContext))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation context");
    }

    private static Set<String> postRoutes(Class<?> controllerType) {
        RequestMapping controllerMapping = controllerType.getAnnotation(RequestMapping.class);
        String prefix = controllerMapping == null || controllerMapping.value().length == 0
                ? "" : controllerMapping.value()[0];
        return Arrays.stream(controllerType.getDeclaredMethods())
                .map(method -> method.getAnnotation(PostMapping.class))
                .filter(Objects::nonNull)
                .flatMap(mapping -> Arrays.stream(mapping.value()))
                .map(path -> prefix + path)
                .collect(Collectors.toSet());
    }

    private static void assertEnvelope(int code, String message) {
        assertThat(code).isEqualTo(200);
        assertThat(message).isEqualTo("OK");
    }
}