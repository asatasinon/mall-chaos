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
public class FixedInternalDispatchService {

    private final OperationDispatchProperties properties;
    private final WebClient webClient;
    private final JwtTokenService jwtTokenService;

    public FixedInternalDispatchService(
            OperationDispatchProperties properties,
            WebClient.Builder webClientBuilder,
            JwtTokenService jwtTokenService) {
        this.properties = properties;
        this.webClient = webClientBuilder.build();
        this.jwtTokenService = jwtTokenService;
    }

    public Mono<Object> inventoryResetPlan(String traceId) {
        return forward("inventory-service", "/internal/inventory/reset/plan", Map.of(), traceId,
                "INVENTORY_RESET", null);
    }

    public Mono<Object> inventoryReset(Map<String, Object> body, String traceId) {
        return forward("inventory-service", "/internal/inventory/reset", body, traceId,
                "INVENTORY_RESET", null);
    }

    public Mono<Object> replenishCoupons(String traceId, String runId) {
        return forward("promotion-service", "/internal/promotions/demo-coupons/replenish", Map.of(), traceId,
                "TRAFFIC_REPLENISH", runId);
    }

    public Mono<Object> replenishStock(String traceId, String runId) {
        return forward("inventory-service", "/internal/inventory/demo-stock/replenish", Map.of(), traceId,
                "TRAFFIC_REPLENISH", runId);
    }

    private Mono<Object> forward(
            String serviceName,
            String path,
            Map<String, Object> body,
            String traceId,
            String action,
            String runId) {
        String baseUrl = properties.getServiceUrl(serviceName);
        if (baseUrl == null || baseUrl.isBlank()) {
            return Mono.error(new IllegalArgumentException("Fixed internal target is not configured"));
        }
        return webClient.post()
            .uri(baseUrl + path)
            .headers(headers -> {
                headers.set("Content-Type", "application/json");
                headers.set(TraceContext.TRACE_ID_HEADER, traceId == null ? "" : traceId);
                headers.set("X-Downstream-Principal", jwtTokenService.issueDownstreamPrincipal(
                    0L, traceId == null ? "" : traceId, List.of(action)));
                if (runId != null) {
                headers.set("X-Replenishment-Run-Id", runId);
                }
            })
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Object.class);
    }
}
