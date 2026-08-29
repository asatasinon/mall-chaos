package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.gateway.service.FixedInternalDispatchService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ReplenishmentDispatchControllerTest {

    @Mock
    private FixedInternalDispatchService dispatchService;

    private ReplenishmentDispatchController controller;

    @BeforeEach
    void setUp() {
        controller = new ReplenishmentDispatchController(dispatchService);
    }

    @Test
    void dispatchesCouponReplenishmentWithoutWorkerParameters() {
        when(dispatchService.replenishCoupons("trace-1", "UTC-6H-1"))
                .thenReturn(Mono.just(Map.of("added", 2)));

        var response = controller.replenishCoupons(Map.of(), "trace-1", "UTC-6H-1").block();

        assertThat(response).isNotNull();
        assertThat(response.getCode()).isEqualTo(200);
        assertThat(response.getData()).isEqualTo(Map.of("added", 2));
        verify(dispatchService).replenishCoupons("trace-1", "UTC-6H-1");
    }

    @Test
    void rejectsCustomReplenishmentParameters() {
        assertThatThrownBy(() -> controller.replenishStock(Map.of("sku", "SKU-001"), null, "UTC-6H-1").block())
                .hasMessageContaining("Replenishment commands do not accept parameters");
    }

    @Test
    void rejectsMissingReplenishmentRunId() {
        assertThatThrownBy(() -> controller.replenishStock(Map.of(), "trace-1", null).block())
                .hasMessageContaining("A valid replenishment run ID is required");
    }
}