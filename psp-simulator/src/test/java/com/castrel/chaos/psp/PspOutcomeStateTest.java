package com.castrel.chaos.psp;

import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PspOutcomeStateTest {

    @Mock
    private ScenarioRunGuard runGuard;

    private PspOutcomeState state;

    @BeforeEach
    void setUp() {
        state = new PspOutcomeState(runGuard);
        when(runGuard.acceptStart(any())).thenReturn(true);
    }

    @Test
    void effectPercentageAppliesToOrdinaryAuthorizationsWithoutRunHeaders() {
        state.prepare(context(), Map.of("providerOutcome", "TIMEOUT", "effectPercentage", 40));

        long timeouts = java.util.stream.IntStream.range(0, 10)
                .filter(index -> "TIMEOUT".equals(state.authorize()))
                .count();

        assertThat(timeouts).isEqualTo(4);
    }

    @Test
    void effectPercentageMustBeAnIntegerBetweenZeroAndOneHundred() {
        assertThatThrownBy(() -> state.prepare(context(), Map.of(
                "providerOutcome", "TIMEOUT", "effectPercentage", 101)))
                .isInstanceOf(com.castrel.chaos.common.BizException.class)
                .hasMessage("effectPercentage must be an integer between 0 and 100");
    }

    private ScenarioRunContext context() {
        return new ScenarioRunContext(
                UUID.randomUUID().toString(), Instant.now().plusSeconds(60), 1, "psp-test-run");
    }
}