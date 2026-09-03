package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.gateway.service.FixedOperationDispatchService;
import com.castrel.chaos.gateway.service.OperationDispatchService;
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
class OperationDispatchControllerTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private static final Map<String, Object> OPERATION_CONTEXT = Map.of(
            "runId", RUN_ID,
            "expiresAt", Instant.now().plusSeconds(60).toString(),
            "fencingToken", 7L,
            "idempotencyKey", "operation-context-1");

    @Mock
    private OperationDispatchService dispatchService;

    @Mock
    private FixedOperationDispatchService operationService;

    private OperationDispatchController controller;

    @BeforeEach
    void setUp() {
        controller = new OperationDispatchController(dispatchService, operationService);
    }

    @Test
    void dispatchesInventoryAvailabilityToFixedTargetWithoutOperationFields() {
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
    void dispatchesProductDetailPreparationToCatalog() {
        Map<String, Object> body = new LinkedHashMap<>(OPERATION_CONTEXT);
        body.put("operation", "product-detail-cache");
        body.put("parameters", Map.of("durationSec", 30));
        when(dispatchService.prepare(
                "catalog-service", "/internal/catalog/product-details/cache/prepare", body, "trace-2"))
                .thenReturn(Mono.just(Map.of("accepted", true)));

        var response = controller.prepare(body, "trace-2").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(200);
        verify(dispatchService).prepare(
                "catalog-service", "/internal/catalog/product-details/cache/prepare", body, "trace-2");
    }

    @Test
    void rejectsUnexpectedOperationContextFields() {
        Map<String, Object> invalidContext = new LinkedHashMap<>(OPERATION_CONTEXT);
        invalidContext.put("unexpected", "value");

        var response = controller.inventoryAvailability(invalidContext, "trace-1").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(400);
    }

    @Test
    void rejectsUnknownOperation() {
        Map<String, Object> startBody = new LinkedHashMap<>(OPERATION_CONTEXT);
        startBody.put("operation", "cart-large-value");
        startBody.put("parameters", Map.of("durationSec", 30));

        var startResponse = controller.prepare(startBody, "trace-3").block();

        assertThat(startResponse).isNotNull();
        assertThat(startResponse.getCode()).isEqualTo(400);
    }

    @Test
    void rejectsUnsupportedStorageCleanupOperation() {
        var response = controller.cleanupAll(
                Map.of("operation", "unknown-operation"), "trace-4").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(400);
    }
}