package com.castrel.chaos.psp;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Value;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import java.util.Map;

@RestController
public class PspController {
    private final PspOutcomeState state;
    private final String internalServiceKey;

    public PspController(PspOutcomeState state,
                         @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String internalServiceKey) {
        this.state = state;
        this.internalServiceKey = internalServiceKey;
    }

    @PostMapping("/api/psp/authorize")
    public ApiResponse<Map<String, Object>> authorize(
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody Map<String, Object> request) {
        requirePaymentAuthority(headers.getFirst("X-Internal-Service-Key"));
        String outcome = state.authorize();
        if ("TIMEOUT".equals(outcome)) {
            try {
                Thread.sleep(60_000);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Provider request was interrupted", exception);
            }
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.GATEWAY_TIMEOUT, "Provider timed out");
        }
        if ("DECLINED".equals(outcome)) return ApiResponse.ok(Map.of("status", "DECLINED", "code", "PROVIDER_DECLINED"));
        return ApiResponse.ok(Map.of("status", "AUTHORIZED", "code", "AUTHORIZED"));
    }

        @PostMapping("/internal/psp/provider-outcome/prepare")
        public ApiResponse<Map<String, Object>> prepareOutcome(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody Map<String, Object> parameters) {
        requireOperation(scenario, operation);
        state.prepare(ScenarioRunContext.fromHeaders(headers), parameters);
        return ApiResponse.ok(Map.of("accepted", true, "scenario", scenario));
    }

        @PostMapping("/internal/psp/provider-outcome/release")
        public ApiResponse<Map<String, Object>> releaseOutcome(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        state.release(context);
        return ApiResponse.ok(Map.of("released", true, "runId", context.runId()));
    }

    @PostMapping("/internal/psp/provider-outcome/cleanup")
    public ApiResponse<Map<String, Object>> cleanupOutcome(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        state.release(context);
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    private void requirePaymentAuthority(String suppliedKey) {
        if (internalServiceKey.isBlank() || suppliedKey == null
                || !MessageDigest.isEqual(internalServiceKey.getBytes(StandardCharsets.UTF_8),
                suppliedKey.getBytes(StandardCharsets.UTF_8))) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.UNAUTHORIZED, "Payment service authentication required");
        }
    }

    private void requireOperation(String scenario, String operation) {
        if (!"PSP_PROVIDER_OUTCOME".equals(scenario) || !"provider-outcome".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported provider operation");
        }
    }
}
