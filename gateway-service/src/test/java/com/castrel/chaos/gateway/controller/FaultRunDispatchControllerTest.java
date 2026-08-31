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
                "inventory-service", "/internal/inventory/availability", OPERATION_CONTEXT, "trace-1"))
                .thenReturn(Mono.just(Map.of("skuCount", 5)));

        var response = controller.inventoryAvailability(OPERATION_CONTEXT, "trace-1").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(200);
        assertThat(response.getData()).isEqualTo(Map.of("skuCount", 5));
        verify(operationService).dispatch(
                "inventory-service", "/internal/inventory/availability", OPERATION_CONTEXT, "trace-1");
    }

    @Test
    void rejectsUnexpectedOperationContextFields() {
        Map<String, Object> invalidContext = new LinkedHashMap<>(OPERATION_CONTEXT);
        invalidContext.put("scenario", "INVENTORY_TABLE_EXCLUSIVE");

        var response = controller.inventoryAvailability(invalidContext, "trace-1").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(400);
    }
}