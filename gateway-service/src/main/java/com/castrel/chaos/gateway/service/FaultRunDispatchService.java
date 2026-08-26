package com.castrel.chaos.gateway.service;

import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.gateway.config.FaultRunDispatchProperties;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;

@Service
public class FaultRunDispatchService {

    private final FaultRunDispatchProperties properties;
    private final WebClient webClient;
    private final JwtTokenService jwtTokenService;

    public FaultRunDispatchService(
            FaultRunDispatchProperties properties,
            WebClient.Builder webClientBuilder,
            JwtTokenService jwtTokenService) {
        this.properties = properties;
        this.webClient = webClientBuilder.build();
        this.jwtTokenService = jwtTokenService;
    }

    public Mono<Object> start(String serviceName, String path, Map<String, Object> body, String traceId) {
        return forward(serviceName, path, body, traceId);
    }

    public Mono<Object> stop(String serviceName, String path, Map<String, Object> body, String traceId) {
        return forward(serviceName, path, body, traceId);
    }

    public Mono<Object> cleanup(String serviceName, String path, Map<String, Object> body, String traceId) {
        return forward(serviceName, path, body, traceId);
    }

    private Mono<Object> forward(
            String serviceName,
            String path,
            Map<String, Object> body,
            String traceId) {
        String baseUrl = properties.getServiceUrl(serviceName);
        if (baseUrl == null || baseUrl.isBlank()) {
            return Mono.error(new IllegalArgumentException("Fixed Fault Run target is not configured"));
        }
        String runId = String.valueOf(body.get("faultRunId"));
        return webClient.post()
                .uri(baseUrl + path)
                .header("Content-Type", "application/json")
                .header(TraceContext.TRACE_ID_HEADER, traceId)
            .header("X-Fault-Run-Id", String.valueOf(body.get("faultRunId")))
            .header("X-Fault-Run-Expires-At", String.valueOf(body.getOrDefault("expiresAt", "")))
            .header("X-Fault-Run-Fencing-Token", String.valueOf(body.get("fencingToken")))
            .header("X-Fault-Run-Idempotency-Key", String.valueOf(body.getOrDefault("idempotencyKey", "")))
                .header("X-Downstream-Principal", jwtTokenService.issueDownstreamPrincipal(
                        0L, runId, List.of("FAULT_RUN_CONTROL")))
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Object.class);
    }
}
