package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.inventory.dto.DemoInventoryReplenishmentResult;
import com.castrel.chaos.inventory.service.InventoryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InventoryReplenishmentControllerTest {

    @Mock
    private InventoryService inventoryService;

    @Mock
    private JwtTokenService jwtTokenService;

    private InventoryController controller;

    @BeforeEach
    void setUp() {
        controller = new InventoryController();
        ReflectionTestUtils.setField(controller, "inventoryService", inventoryService);
        ReflectionTestUtils.setField(controller, "jwtTokenService", jwtTokenService);
        ReflectionTestUtils.setField(controller, "internalServiceKey", "internal-secret");
    }

    @Test
    void acceptsReplenishmentPrincipalWithoutWorkerParameters() {
        var result = new DemoInventoryReplenishmentResult("UTC-6H-1", "trace-1", 1, 60, 0, 0);
        when(jwtTokenService.verifyDownstreamPrincipal("principal"))
                .thenReturn(new JwtTokenService.DownstreamPrincipal(
                        0L, "trace-1", List.of("TRAFFIC_REPLENISH"), "token-id"));
        when(inventoryService.replenishDemoInventory()).thenReturn(result);

        var response = controller.replenishDemoStock(Map.of(), "principal", null);

        assertThat(response.getData()).isEqualTo(result);
        verify(inventoryService).replenishDemoInventory();
    }

    @Test
    void acceptsTheConfiguredInternalServiceKey() {
        when(inventoryService.replenishDemoInventory())
                .thenReturn(new DemoInventoryReplenishmentResult("window", "trace", 1, 0, 1, 0));

        var response = controller.replenishDemoStock(Map.of(), null, "internal-secret");

        assertThat(response.getCode()).isEqualTo(200);
        verify(inventoryService).replenishDemoInventory();
    }

    @Test
    void rejectsCustomParametersAndWrongPrincipal() {
        assertThatThrownBy(() -> controller.replenishDemoStock(
                Map.of("sku", "SKU-999"), "principal", null))
                .hasMessageContaining("does not accept parameters");

        when(jwtTokenService.verifyDownstreamPrincipal("customer-principal"))
                .thenReturn(new JwtTokenService.DownstreamPrincipal(
                        7L, "trace-1", List.of("CUSTOMER_API"), "token-id"));
        assertThatThrownBy(() -> controller.replenishDemoStock(
                Map.of(), "customer-principal", null))
                .hasMessageContaining("authentication required");
    }
}
