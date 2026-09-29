package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;

import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OrderReportOperationsControllerContractTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private final OrderReportOperationsController controller = new OrderReportOperationsController();

    @Test
    void exposesTheCataloguedReportLifecycleRoutes() {
        assertThat(postRoutes(OrderReportOperationsController.class)).contains(
                "/internal/orders/reports/order-query/prepare",
                "/internal/orders/reports/order-query/release",
                "/internal/orders/reports/order-query/cleanup");
    }

    @Test
    void acceptsFullPrepareAndReleaseContextAndMinimalCleanupContext() {
        HttpHeaders fullContext = fullContext();
        HttpHeaders cleanupContext = cleanupContext();

        ApiResponse<Map<String, Object>> prepare = controller.prepareOrderQueryReport(fullContext);
        ApiResponse<Map<String, Object>> release = controller.releaseOrderQueryReport(fullContext);
        ApiResponse<Map<String, Object>> cleanup = controller.cleanupOrderQueryReport(cleanupContext);

        assertEnvelope(prepare);
        assertThat(prepare.getData()).containsEntry("accepted", true)
                .containsEntry("operation", "orders-query-report");
        assertEnvelope(release);
        assertThat(release.getData()).containsEntry("released", true)
                .containsEntry("operation", "orders-query-report");
        assertEnvelope(cleanup);
        assertThat(cleanup.getData()).containsEntry("cleaned", true);
    }

    @Test
    void rejectsPrepareWithoutTheRequiredOperationContext() {
        assertThatThrownBy(() -> controller.prepareOrderQueryReport(new HttpHeaders()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation context");
    }

    private static HttpHeaders fullContext() {
        HttpHeaders headers = cleanupContext();
        headers.set("X-Operation-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Operation-Run-Idempotency-Key", "phase-three-order-001");
        return headers;
    }

    private static HttpHeaders cleanupContext() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Operation-Run-Id", RUN_ID);
        headers.set("X-Operation-Run-Fencing-Token", "7");
        return headers;
    }

    private static Set<String> postRoutes(Class<?> controllerType) {
        return Arrays.stream(controllerType.getDeclaredMethods())
                .map(method -> method.getAnnotation(PostMapping.class))
                .filter(Objects::nonNull)
                .flatMap(mapping -> Arrays.stream(mapping.value()))
                .collect(Collectors.toSet());
    }

    private static void assertEnvelope(ApiResponse<?> response) {
        assertThat(response.getCode()).isEqualTo(200);
        assertThat(response.getMessage()).isEqualTo("OK");
    }
}
