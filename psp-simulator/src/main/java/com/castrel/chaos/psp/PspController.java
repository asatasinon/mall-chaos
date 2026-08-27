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
    private final PspScenarioState state;
    private final String internalServiceKey;

    public PspController(PspScenarioState state,
                         @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String internalServiceKey) {
        this.state = state;
        this.internalServiceKey = internalServiceKey;
    }

    @PostMapping("/api/psp/authorize")
    public ApiResponse<Map<String, Object>> authorize(
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody Map<String, Object> request) {
        requirePaymentAuthority(headers.getFirst("X-Internal-Service-Key"));
        ScenarioRunContext context = contextFromHeaders(headers);
        String outcome = state.authorize(context == null ? null : context.runId(),
            context == null ? -1 : context.fencingToken());
        if ("TIMEOUT".equals(outcome)) {
            try {
                Thread.sleep(10_000);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new BizException("PSP_INTERRUPTED", "Provider request was interrupted", exception);
            }
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.GATEWAY_TIMEOUT, "Provider timed out");
        }
        if ("DECLINED".equals(outcome)) return ApiResponse.ok(Map.of("status", "DECLINED", "code", "PROVIDER_DECLINED"));
        return ApiResponse.ok(Map.of("status", "AUTHORIZED", "code", "AUTHORIZED"));
    }

    @PostMapping("/internal/psp/fault-runs/start")
    public ApiResponse<Map<String, Object>> start(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody Map<String, Object> parameters) {
        requireOperation(scenario, operation);
        state.start(ScenarioRunContext.fromHeaders(headers), parameters);
        return ApiResponse.ok(Map.of("accepted", true, "scenario", scenario));
    }

    @PostMapping("/internal/psp/fault-runs/stop")
    public ApiResponse<Map<String, Object>> stop(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        state.stop(context);
        return ApiResponse.ok(Map.of("released", true, "faultRunId", context.runId()));
    }

    @PostMapping("/internal/psp/fault-runs/cleanup")
    public ApiResponse<Map<String, Object>> cleanup(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        state.stop(context);
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    private ScenarioRunContext contextFromHeaders(org.springframework.http.HttpHeaders headers) {
        if (headers.getFirst("X-Fault-Run-Id") == null) return null;
        try {
            ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
            context.validate(java.time.Instant.now());
            return context;
        } catch (IllegalArgumentException exception) {
            throw new BizException("INVALID_PROVIDER_CONTEXT", "Provider context is invalid", exception);
        }
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
