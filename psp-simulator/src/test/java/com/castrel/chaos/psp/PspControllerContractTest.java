package com.castrel.chaos.psp;

import com.castrel.chaos.common.coordination.OperationRunContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;

import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class PspControllerContractTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";

    @Mock
    private PspOutcomeState state;

    private PspController controller;

    @BeforeEach
    void setUp() {
        controller = new PspController(state, "internal-key");
    }

    @Test
    void exposesTheProviderOutcomeLifecycleRoutes() {
        assertThat(postRoutes(PspController.class)).contains(
                "/internal/psp/provider-outcome/prepare",
                "/internal/psp/provider-outcome/release",
                "/internal/psp/provider-outcome/cleanup");
    }

    @Test
    void forwardsParametersAndFullLifecycleContextAndAcceptsMinimalCleanup() {
        HttpHeaders fullHeaders = fullContext();
        HttpHeaders cleanupHeaders = cleanupContext();
        OperationRunContext fullContext = OperationRunContext.fromHeaders(fullHeaders);
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);
        Map<String, Object> parameters = Map.of("providerOutcome", "DECLINED", "effectPercentage", 40);

        var prepare = controller.prepareOutcome(fullHeaders, parameters);
        var release = controller.releaseOutcome(fullHeaders);
        var cleanup = controller.cleanupOutcome(cleanupHeaders);

        assertEnvelope(prepare.getCode(), prepare.getMessage());
        assertThat(prepare.getData()).containsEntry("accepted", true).containsEntry("operation", "provider-outcome");
        assertEnvelope(release.getCode(), release.getMessage());
        assertThat(release.getData()).containsEntry("released", true)
                .containsEntry("runId", RUN_ID)
                .containsEntry("operation", "provider-outcome");
        assertEnvelope(cleanup.getCode(), cleanup.getMessage());
        assertThat(cleanup.getData()).containsEntry("cleaned", true);
        verify(state).prepare(fullContext, parameters);
        verify(state).release(fullContext);
        verify(state).cleanup(cleanupContext);
    }

    private static HttpHeaders fullContext() {
        HttpHeaders headers = cleanupContext();
        headers.set("X-Operation-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Operation-Run-Idempotency-Key", "phase-three-provider-001");
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

    private static void assertEnvelope(int code, String message) {
        assertThat(code).isEqualTo(200);
        assertThat(message).isEqualTo("OK");
    }
}
