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
public class FixedOperationDispatchService {
    private final ScenarioDispatchProperties properties;
    private final WebClient webClient;
    private final JwtTokenService jwtTokenService;

    public FixedOperationDispatchService(ScenarioDispatchProperties properties, WebClient.Builder builder,
                                         JwtTokenService jwtTokenService) {
        this.properties = properties;
        this.webClient = builder.build();
        this.jwtTokenService = jwtTokenService;
    }

    public Mono<Object> dispatch(String serviceName, String path, Map<String, Object> context, String traceId) {
        String baseUrl = properties.getServiceUrl(serviceName);
        if (baseUrl == null || baseUrl.isBlank()) {
            return Mono.error(new IllegalArgumentException("Fixed operation target is not configured"));
        }
        String runId = String.valueOf(context.get("runId"));
        return webClient.post()
                .uri(baseUrl + path)
                .header("Content-Type", "application/json")
                .header(TraceContext.TRACE_ID_HEADER, traceId == null ? "" : traceId)
                .header("X-Scenario-Run-Id", runId)
                .header("X-Scenario-Run-Expires-At", String.valueOf(context.get("expiresAt")))
                .header("X-Scenario-Run-Fencing-Token", String.valueOf(context.get("fencingToken")))
                .header("X-Scenario-Run-Idempotency-Key", String.valueOf(context.get("idempotencyKey")))
                .header("X-Downstream-Principal", jwtTokenService.issueDownstreamPrincipal(
                    0L, runId, List.of("SCENARIO_CONTROL")))
                .bodyValue(context)
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