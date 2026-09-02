package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.service.CatalogDependencyState;
import com.castrel.chaos.catalog.service.ProductDetailCacheProvisioningService;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CatalogFaultRunControllerTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private static final String OPERATION = "catalog-product-detail-large-value";

    @Mock
    private CatalogDependencyState dependencyState;

    @Mock
    private ScenarioRunGuard runGuard;

    @Mock
    private ProductDetailCacheProvisioningService provisioningService;

    private CatalogFaultRunController controller;
    private HttpHeaders headers;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        controller = new CatalogFaultRunController(dependencyState, runGuard, provisioningService);
        headers = new HttpHeaders();
        headers.set("X-Fault-Run-Id", RUN_ID);
        headers.set("X-Fault-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Fault-Run-Fencing-Token", "7");
        headers.set("X-Fault-Run-Idempotency-Key", "phase-d-controller-001");
        request = new MockHttpServletRequest();
        request.setAttribute("castrel.allowedActions", List.of("FAULT_RUN_CONTROL"));
    }

    @Test
    void routesCatalogStartToProvisioningServiceWithParameters() {
        Map<String, Object> parameters = Map.of("durationSec", 30, "memberCount", 2);
        when(provisioningService.start(
                eq(new ScenarioRunContext(RUN_ID, Instant.parse(headers.getFirst("X-Fault-Run-Expires-At")), 7,
                        "phase-d-controller-001")), eq(parameters)))
                .thenReturn(Map.of("accepted", true, "layout", "HASH"));

        var response = controller.start(
                ProductDetailCacheProvisioningService.SCENARIO, OPERATION, headers, parameters, request);

        assertThat(response.getData()).containsEntry("accepted", true);
        verify(provisioningService).start(
                eq(new ScenarioRunContext(RUN_ID, Instant.parse(headers.getFirst("X-Fault-Run-Expires-At")), 7,
                        "phase-d-controller-001")), eq(parameters));
    }

    @Test
    void rejectsCatalogProvisioningWithoutControlScope() {
        request.removeAttribute("castrel.allowedActions");

        assertThatThrownBy(() -> controller.start(
                ProductDetailCacheProvisioningService.SCENARIO, OPERATION, headers, Map.of(), request))
                .isInstanceOf(BizException.class)
                .extracting("errorCode")
                .isEqualTo("INTERNAL_AUTH_REQUIRED");
    }

        @Test
        void rejectsCatalogScenarioWithAnUnexpectedOperation() {
                assertThatThrownBy(() -> controller.start(
                                ProductDetailCacheProvisioningService.SCENARIO,
                                "unexpected-operation",
                                headers,
                                Map.of(),
                                request))
                                .isInstanceOf(BizException.class)
                                .extracting("errorCode")
                                .isEqualTo("SCENARIO_OPERATION_MISMATCH");
        }

        @Test
        void rejectsUnexpectedScenarioForTheCatalogLargeValueOperation() {
                assertThatThrownBy(() -> controller.start(
                                "CART_CATALOG_DEPENDENCY",
                                OPERATION,
                                headers,
                                Map.of(),
                                request))
                                .isInstanceOf(BizException.class)
                                .extracting("errorCode")
                                .isEqualTo("SCENARIO_OPERATION_MISMATCH");
        }

    @Test
    void routesCatalogStopAndCleanupToProvisioningService() {
        var context = new ScenarioRunContext(
                RUN_ID, Instant.parse(headers.getFirst("X-Fault-Run-Expires-At")), 7,
                "phase-d-controller-001");
        when(provisioningService.stop(context)).thenReturn(Map.of("released", true));
        when(provisioningService.cleanup(RUN_ID, 7)).thenReturn(Map.of("hashRemoved", true));

        var stopResponse = controller.stop(
                ProductDetailCacheProvisioningService.SCENARIO, OPERATION, headers, request);
        var cleanupResponse = controller.cleanup(
                ProductDetailCacheProvisioningService.SCENARIO, headers, request);

        assertThat(stopResponse.getData()).containsEntry("released", true);
        assertThat(cleanupResponse.getData()).containsEntry("hashRemoved", true);
        verify(provisioningService).stop(context);
        verify(provisioningService).cleanup(RUN_ID, 7L);
    }

    @Test
    void allowsCatalogCleanupWithTheMinimalGatewayCleanupHeaders() {
        HttpHeaders cleanupHeaders = new HttpHeaders();
        cleanupHeaders.set("X-Fault-Run-Id", RUN_ID);
        cleanupHeaders.set("X-Fault-Run-Fencing-Token", "7");
        when(provisioningService.cleanup(RUN_ID, 7L)).thenReturn(Map.of(
                "released", true, "hashRemoved", false));

        var response = controller.cleanup(
                ProductDetailCacheProvisioningService.SCENARIO, cleanupHeaders, request);

        assertThat(response.getData()).containsEntry("released", true);
        verify(provisioningService).cleanup(RUN_ID, 7L);
    }
}
