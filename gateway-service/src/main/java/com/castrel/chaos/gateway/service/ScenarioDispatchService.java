package com.castrel.chaos.gateway.service;

import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.gateway.config.ScenarioDispatchProperties;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;

@Service
public class ScenarioDispatchService {

    private final ScenarioDispatchProperties properties;
    private final WebClient webClient;
    private final JwtTokenService jwtTokenService;

    public ScenarioDispatchService(
            ScenarioDispatchProperties properties,
            WebClient.Builder webClientBuilder,
            JwtTokenService jwtTokenService) {
        this.properties = properties;
        this.webClient = webClientBuilder.build();
        this.jwtTokenService = jwtTokenService;
    }

    public Mono<Object> prepare(String serviceName, String path, Map<String, Object> body, String traceId) {
        return forward(serviceName, path, body, startParameters(body), traceId);
    }

    public Mono<Object> release(String serviceName, String path, Map<String, Object> body, String traceId) {
        return forward(serviceName, path, body, body, traceId);
    }

    public Mono<Object> cleanup(String serviceName, String path, Map<String, Object> body, String traceId) {
        return forward(serviceName, path, body, body, traceId);
    }

    private Map<String, Object> startParameters(Map<String, Object> body) {
        Object parameters = body.get("parameters");
        if (!(parameters instanceof Map<?, ?> values)) return Map.of();
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        values.forEach((key, value) -> {
            if (key instanceof String name) result.put(name, value);
        });
        return result;
    }

    private Mono<Object> forward(
            String serviceName,
            String path,
            Map<String, Object> body,
            Object requestBody,
            String traceId) {
        String baseUrl = properties.getServiceUrl(serviceName);
        if (baseUrl == null || baseUrl.isBlank()) {
            return Mono.error(new IllegalArgumentException("Fixed scenario target is not configured"));
        }
        String runId = String.valueOf(body.get("runId"));
        return webClient.post()
                .uri(baseUrl + path)
                .header("Content-Type", "application/json")
                .header(TraceContext.TRACE_ID_HEADER, traceId)
                .header("X-Scenario-Run-Id", runId)
                .header("X-Scenario-Run-Scenario", String.valueOf(body.getOrDefault("scenario", "")))
                .header("X-Scenario-Run-Operation", String.valueOf(body.getOrDefault("operation", "")))
                .header("X-Scenario-Run-Operation-Id", String.valueOf(body.getOrDefault("operationId", body.get("idempotencyKey"))))
                .header("X-Scenario-Run-Expires-At", String.valueOf(body.getOrDefault("expiresAt", "")))
                .header("X-Scenario-Run-Fencing-Token", String.valueOf(body.get("fencingToken")))
                .header("X-Scenario-Run-Idempotency-Key", String.valueOf(body.getOrDefault("idempotencyKey", "")))
                .header("X-Downstream-Principal", jwtTokenService.issueDownstreamPrincipal(
                        0L, runId, List.of("SCENARIO_CONTROL")))
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(Object.class)
                .flatMap(this::requireSuccessfulResponse);
    }

    private Mono<Object> requireSuccessfulResponse(Object response) {
        if (response instanceof Map<?, ?> map && map.get("code") instanceof Number code && code.intValue() >= 400) {
            return Mono.error(new IllegalStateException("Fixed scenario target rejected request"));
        }
        return Mono.just(response);
    }
}