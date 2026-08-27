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
public class FaultRunProbeService {
    private final FaultRunDispatchProperties properties;
    private final WebClient webClient;
    private final JwtTokenService jwtTokenService;

    public FaultRunProbeService(FaultRunDispatchProperties properties, WebClient.Builder builder,
                                JwtTokenService jwtTokenService) {
        this.properties = properties;
        this.webClient = builder.build();
        this.jwtTokenService = jwtTokenService;
    }

    public Mono<Object> probe(String serviceName, String path, Map<String, Object> body, String traceId) {
        String baseUrl = properties.getServiceUrl(serviceName);
        if (baseUrl == null || baseUrl.isBlank()) return Mono.error(new IllegalArgumentException("Fixed probe target is not configured"));
        return webClient.post().uri(baseUrl + path)
                .header("Content-Type", "application/json")
                .header(TraceContext.TRACE_ID_HEADER, traceId == null ? "" : traceId)
                .header("X-Fault-Run-Id", String.valueOf(body.get("faultRunId")))
                .header("X-Fault-Run-Scenario", String.valueOf(body.get("scenario")))
                .header("X-Fault-Run-Operation", String.valueOf(body.get("operation")))
                .header("X-Fault-Run-Expires-At", String.valueOf(body.get("expiresAt")))
                .header("X-Fault-Run-Fencing-Token", String.valueOf(body.get("fencingToken")))
                .header("X-Fault-Run-Idempotency-Key", String.valueOf(body.get("idempotencyKey")))
                .header("X-Downstream-Principal", jwtTokenService.issueDownstreamPrincipal(
                        0L, String.valueOf(body.get("faultRunId")), List.of("FAULT_RUN_CONTROL")))
                .bodyValue(body).retrieve().bodyToMono(Object.class)
                .flatMap(this::requireSuccessfulResponse);
    }

    private Mono<Object> requireSuccessfulResponse(Object response) {
        if (response instanceof Map<?, ?> map && map.get("code") instanceof Number code && code.intValue() >= 400) {
            return Mono.error(new IllegalStateException("Fixed target rejected Fault Run probe"));
        }
        return Mono.just(response);
    }
}
