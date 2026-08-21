package com.castrel.chaos.gateway.service;

import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.gateway.config.ChaosDispatchProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ChaosDispatchService {

    private static final Logger log = LoggerFactory.getLogger(ChaosDispatchService.class);
    private final ChaosDispatchProperties props;
    private final WebClient webClient;
    private final JwtTokenService jwtTokenService;

    public ChaosDispatchService(
            ChaosDispatchProperties props, WebClient.Builder webClientBuilder, JwtTokenService jwtTokenService) {
        this.props = props;
        this.webClient = webClientBuilder.build();
        this.jwtTokenService = jwtTokenService;
    }

    /**
     * Dispatch a POST request to multiple target services in parallel.
     * Returns a map of serviceName -> result/error.
     */
    public Mono<Map<String, Object>> dispatchPost(
            String chaosType,
            List<String> targets,
            String subPath,
            Object body,
            String traceId
    ) {
        List<String> validTargets = validateTargets(chaosType, targets);
        if (validTargets.isEmpty()) {
            return Mono.just(Map.of("error", "No valid target services for chaos type: " + chaosType));
        }

        return Flux.fromIterable(validTargets)
                .flatMap(service -> forwardPost(service, subPath, body, traceId)
                        .map(result -> Map.entry(service, (Object) result))
                        .onErrorResume(e -> {
                            log.warn("Dispatch to {} failed: {}", service, e.getMessage());
                            return Mono.just(Map.entry(service, (Object) Map.of("error", e.getMessage())));
                        })
                )
                .collectList()
                .map(entries -> {
                    Map<String, Object> result = new LinkedHashMap<>();
                    for (var entry : entries) {
                        result.put(entry.getKey(), entry.getValue());
                    }
                    return result;
                });
    }

    /**
     * Dispatch a GET status request to multiple target services in parallel.
     */
    public Mono<Map<String, Object>> dispatchGet(
            String chaosType,
            List<String> targets,
            String subPath,
            String traceId
    ) {
        List<String> validTargets;
        if (targets == null || targets.isEmpty()) {
            validTargets = props.getAllowedServices(chaosType);
        } else {
            validTargets = validateTargets(chaosType, targets);
        }

        return Flux.fromIterable(validTargets)
                .flatMap(service -> forwardGet(service, subPath, traceId)
                        .map(result -> Map.entry(service, (Object) result))
                        .onErrorResume(e -> {
                            log.warn("Status from {} failed: {}", service, e.getMessage());
                            return Mono.just(Map.entry(service, (Object) Map.of("error", e.getMessage())));
                        })
                )
                .collectList()
                .map(entries -> {
                    Map<String, Object> result = new LinkedHashMap<>();
                    for (var entry : entries) {
                        result.put(entry.getKey(), entry.getValue());
                    }
                    return result;
                });
    }

    public Mono<Object> postToService(
            String serviceName,
            String subPath,
            Object body,
            String traceId
    ) {
        return forwardPost(serviceName, subPath, body, traceId);
    }

    public Mono<Object> getFromService(
            String serviceName,
            String subPath,
            String traceId
    ) {
        return forwardGet(serviceName, subPath, traceId);
    }

    private List<String> validateTargets(String chaosType, List<String> targets) {
        return targets.stream()
                .filter(t -> props.isAllowed(chaosType, t))
                .toList();
    }

    private Mono<Object> forwardPost(String serviceName, String subPath, Object body, String traceId) {
        String baseUrl = props.getServiceUrl(serviceName);
        if (baseUrl == null) {
            return Mono.error(new IllegalArgumentException("Unknown service: " + serviceName));
        }
        String url = baseUrl + subPath;
        log.debug("Dispatching POST {} to {}", subPath, url);

        var request = webClient.post()
                .uri(url)
                .header("Content-Type", "application/json");
        if (traceId != null) {
            request.header(TraceContext.TRACE_ID_HEADER, traceId);
        }
        request.header("X-Downstream-Principal",
            jwtTokenService.issueDownstreamPrincipal(0L, traceId == null ? "" : traceId,
                List.of("CHAOS_DISPATCH")));
        return request
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Object.class);
    }

    private Mono<Object> forwardGet(String serviceName, String subPath, String traceId) {
        String baseUrl = props.getServiceUrl(serviceName);
        if (baseUrl == null) {
            return Mono.error(new IllegalArgumentException("Unknown service: " + serviceName));
        }
        String url = baseUrl + subPath;

        var request = webClient.get().uri(url);
        if (traceId != null) {
            request.header(TraceContext.TRACE_ID_HEADER, traceId);
        }
        request.header("X-Downstream-Principal",
            jwtTokenService.issueDownstreamPrincipal(0L, traceId == null ? "" : traceId,
                List.of("CHAOS_DISPATCH")));
        return request
                .retrieve()
                .bodyToMono(Object.class);
    }
}
