package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.gateway.service.FaultRunDispatchService;
import com.castrel.chaos.gateway.service.FixedOperationDispatchService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class FaultRunDispatchControllerTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private static final Map<String, Object> OPERATION_CONTEXT = Map.of(
            "faultRunId", RUN_ID,
            "expiresAt", Instant.now().plusSeconds(60).toString(),
            "fencingToken", 7L,
            "idempotencyKey", "operation-context-1");

    @Mock
    private FaultRunDispatchService dispatchService;

    @Mock
    private FixedOperationDispatchService operationService;

    private FaultRunDispatchController controller;

    @BeforeEach
    void setUp() {
        controller = new FaultRunDispatchController(dispatchService, operationService);
    }

    @Test
    void dispatchesInventoryAvailabilityToFixedTargetWithoutScenarioFields() {
        when(operationService.dispatch(
            "inventory-service", "/internal/inventory/availability/report", OPERATION_CONTEXT, "trace-1"))
                .thenReturn(Mono.just(Map.of("skuCount", 5)));

        var response = controller.inventoryAvailability(OPERATION_CONTEXT, "trace-1").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(200);
        assertThat(response.getData()).isEqualTo(Map.of("skuCount", 5));
        verify(operationService).dispatch(
            "inventory-service", "/internal/inventory/availability/report", OPERATION_CONTEXT, "trace-1");
        }

        @Test
        void dispatchesInventoryReservationSummaryToSeparateTarget() {
        when(operationService.dispatch(
            "inventory-service", "/internal/inventory/reservations/summary", OPERATION_CONTEXT, "trace-row"))
            .thenReturn(Mono.just(Map.of("sku", "SKU-001")));

        var response = controller.inventoryReservationSummary(OPERATION_CONTEXT, "trace-row").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(200);
        assertThat(response.getData()).isEqualTo(Map.of("sku", "SKU-001"));
        verify(operationService).dispatch(
            "inventory-service", "/internal/inventory/reservations/summary", OPERATION_CONTEXT, "trace-row");
    }

    @Test
    void rejectsUnexpectedOperationContextFields() {
        Map<String, Object> invalidContext = new LinkedHashMap<>(OPERATION_CONTEXT);
        invalidContext.put("scenario", "INVENTORY_TABLE_EXCLUSIVE");

        var response = controller.inventoryAvailability(invalidContext, "trace-1").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(400);
    }

    @Test
    void dispatchesCatalogLargeValueToTheFixedCatalogTarget() {
        Map<String, Object> body = new LinkedHashMap<>(OPERATION_CONTEXT);
        body.put("scenario", "CATALOG_REDIS_LARGE_VALUE");
        body.put("operation", "catalog-product-detail-large-value");
        body.put("parameters", Map.of(
                "durationSec", 30,
                "memberCount", 8,
                "memberSizeBytes", 65536,
                "concurrency", 4,
                "requestIntervalMs", 100,
                "keyTtlSec", 900));
        when(dispatchService.start(
                "catalog-service", "/internal/catalog/fault-runs/start", body, "trace-2"))
                .thenReturn(Mono.just(Map.of("accepted", true, "layout", "HASH")));

        var response = controller.start(body, "trace-2").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(200);
        verify(dispatchService).start(
                "catalog-service", "/internal/catalog/fault-runs/start", body, "trace-2");
    }

        @Test
        void dispatchesInventoryRowLockToSeparateTargetEndpoints() {
        Map<String, Object> body = new LinkedHashMap<>(OPERATION_CONTEXT);
        body.put("scenario", "INVENTORY_ROW_LOCK");
        body.put("operation", "inventory-reservation-summary");
        body.put("parameters", Map.of("durationSec", 30));
        when(dispatchService.start(
            "inventory-service", "/internal/inventory/reservations/prepare", body, "trace-row-start"))
            .thenReturn(Mono.just(Map.of("accepted", true)));

        var response = controller.start(body, "trace-row-start").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(200);
        verify(dispatchService).start(
            "inventory-service", "/internal/inventory/reservations/prepare", body, "trace-row-start");
        }

    @Test
    void rejectsLegacyCartLargeValueStart() {
        Map<String, Object> startBody = new LinkedHashMap<>(OPERATION_CONTEXT);
        startBody.put("scenario", "CART_REDIS_LARGE_VALUE");
        startBody.put("operation", "cart-large-value");
        startBody.put("parameters", Map.of("durationSec", 30));

        var startResponse = controller.start(startBody, "trace-3").block();

        assertThat(startResponse).isNotNull();
        assertThat(startResponse.getCode()).isEqualTo(400);
    }

    @Test
    void rejectsLegacyCartScenarioWideCleanup() {
        var response = controller.cleanupScenario(
                Map.of("scenario", "CART_REDIS_LARGE_VALUE"), "trace-4").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(400);
    }
}