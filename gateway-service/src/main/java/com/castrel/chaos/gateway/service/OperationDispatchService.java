package com.castrel.chaos.gateway.service;

import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.gateway.config.OperationDispatchProperties;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;

@Service
public class OperationDispatchService {

    private final OperationDispatchProperties properties;
    private final WebClient webClient;
    private final JwtTokenService jwtTokenService;

    public OperationDispatchService(
            OperationDispatchProperties properties,
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
            return Mono.error(new IllegalArgumentException("Fixed operation target is not configured"));
        }
        String runId = body.get("runId") instanceof String value ? value : null;
        return webClient.post()
                .uri(baseUrl + path)
                .headers(headers -> {
                    headers.set("Content-Type", "application/json");
                    headers.set(TraceContext.TRACE_ID_HEADER, traceId);
                    if (runId != null) {
                        headers.set("X-Operation-Run-Id", runId);
                        headers.set("X-Operation-Run-Expires-At", String.valueOf(body.getOrDefault("expiresAt", "")));
                        headers.set("X-Operation-Run-Fencing-Token", String.valueOf(body.get("fencingToken")));
                        headers.set("X-Operation-Run-Idempotency-Key", String.valueOf(body.getOrDefault("idempotencyKey", "")));
                        headers.set("X-Downstream-Principal", jwtTokenService.issueDownstreamPrincipal(
                                0L, runId, List.of("OPERATION_CONTROL")));
                    }
                })
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(Object.class)
                .flatMap(this::requireSuccessfulResponse);
    }

    private Mono<Object> requireSuccessfulResponse(Object response) {
        if (response instanceof Map<?, ?> map && map.get("code") instanceof Number code && code.intValue() >= 400) {
            return Mono.error(new IllegalStateException("Fixed operation target rejected request"));
        }
        return Mono.just(response);
    }
}
