package com.castrel.chaos.promotion.controller;

import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.promotion.dto.DemoCouponReplenishmentResult;
import com.castrel.chaos.promotion.service.PromotionService;
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
class PromotionReplenishmentControllerTest {

    @Mock
    private PromotionService promotionService;

    @Mock
    private JwtTokenService jwtTokenService;

    private PromotionController controller;

    @BeforeEach
    void setUp() {
        controller = new PromotionController();
        ReflectionTestUtils.setField(controller, "promotionService", promotionService);
        ReflectionTestUtils.setField(controller, "jwtTokenService", jwtTokenService);
    }

    @Test
    void acceptsOnlyReplenishmentPrincipalAndNoParameters() {
        var result = new DemoCouponReplenishmentResult("UTC-6H-1", "trace-1", 1, 2, 3, 0, 0);
        when(jwtTokenService.verifyDownstreamPrincipal("principal"))
                .thenReturn(new JwtTokenService.DownstreamPrincipal(
                        0L, "trace-1", List.of("TRAFFIC_REPLENISH"), "token-id"));
        when(promotionService.replenishDemoCouponPool("manual:run-1")).thenReturn(result);

        var response = controller.replenishDemoCoupons(Map.of(), "principal", "manual:run-1");

        assertThat(response.getData()).isEqualTo(result);
        verify(promotionService).replenishDemoCouponPool("manual:run-1");
    }

    @Test
    void rejectsWorkerSuppliedParameters() {
        assertThatThrownBy(() -> controller.replenishDemoCoupons(
            Map.of("customerId", 99), "principal", "UTC-6H-1"))
                .hasMessageContaining("does not accept parameters");
    }

    @Test
    void rejectsPrincipalWithoutReplenishmentScope() {
        when(jwtTokenService.verifyDownstreamPrincipal("customer-principal"))
                .thenReturn(new JwtTokenService.DownstreamPrincipal(
                        7L, "trace-1", List.of("CUSTOMER_API"), "token-id"));

        assertThatThrownBy(() -> controller.replenishDemoCoupons(
            Map.of(), "customer-principal", "UTC-6H-1"))
                .hasMessageContaining("authentication required");
    }
}
