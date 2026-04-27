package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.gateway.config.ToxiproxyProperties;
import com.castrel.chaos.gateway.dto.NetworkFaultRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.Map;

@RestController
@RequestMapping("/internal/gateway")
public class NetworkFaultDispatchController {

    private static final Logger log = LoggerFactory.getLogger(NetworkFaultDispatchController.class);
    private final WebClient toxiproxyClient;
    private final ToxiproxyProperties toxiproxyProps;

    public NetworkFaultDispatchController(
            WebClient.Builder webClientBuilder,
            ToxiproxyProperties toxiproxyProps
    ) {
        this.toxiproxyClient = webClientBuilder.baseUrl(toxiproxyProps.getApiUrl()).build();
        this.toxiproxyProps = toxiproxyProps;
    }

    // ── Network Delay ────────────────────────────────────────────────────

    @PostMapping("/network-delay/enable")
    public Mono<ApiResponse<Object>> enableNetworkDelay(
            @RequestBody NetworkFaultRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        if (!toxiproxyProps.isProxyAllowed(req.proxyName())) {
            return Mono.just(ApiResponse.error(400, "Proxy not in whitelist: " + req.proxyName()));
        }
        Map<String, Object> toxicBody = Map.of(
                "name", req.proxyName() + "_latency",
                "type", "latency",
                "stream", "downstream",
                "toxicity", 1.0,
                "attributes", Map.of(
                        "latency", req.latencyMs(),
                        "jitter", req.jitter()
                )
        );
        return toxiproxyClient.post()
                .uri("/proxies/{proxy}/toxics", req.proxyName())
                .bodyValue(toxicBody)
                .retrieve()
                .bodyToMono(Object.class)
                .map(ApiResponse::ok)
                .onErrorResume(e -> {
                    log.warn("Enable network delay failed: {}", e.getMessage());
                    return Mono.just(ApiResponse.error(502, "ToxiProxy error: " + e.getMessage()));
                });
    }

    @PostMapping("/network-delay/disable")
    public Mono<ApiResponse<Object>> disableNetworkDelay(
            @RequestBody(required = false) NetworkFaultRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        String proxyName = req != null ? req.proxyName() : null;
        if (proxyName == null) {
            return Mono.just(ApiResponse.error(400, "proxyName is required"));
        }
        if (!toxiproxyProps.isProxyAllowed(proxyName)) {
            return Mono.just(ApiResponse.error(400, "Proxy not in whitelist: " + proxyName));
        }
        String toxicName = proxyName + "_latency";
        return toxiproxyClient.delete()
                .uri("/proxies/{proxy}/toxics/{toxic}", proxyName, toxicName)
                .retrieve()
                .bodyToMono(Object.class)
                .defaultIfEmpty(Map.of("removed", toxicName))
                .map(ApiResponse::ok)
                .onErrorResume(e -> {
                    log.warn("Disable network delay failed: {}", e.getMessage());
                    return Mono.just(ApiResponse.ok(Map.of("message", "Toxic may not exist: " + e.getMessage())));
                });
    }

    @GetMapping("/network-delay/status")
    public Mono<ApiResponse<Object>> networkDelayStatus(
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return toxiproxyClient.get()
                .uri("/proxies")
                .retrieve()
                .bodyToMono(new org.springframework.core.ParameterizedTypeReference<Map<String, Map<String, Object>>>() {})
                .map(proxies -> {
                    Map<String, Object> perProxy = new java.util.LinkedHashMap<>();
                    boolean anyActive = false;
                    for (var entry : proxies.entrySet()) {
                        Object toxicsRaw = entry.getValue().get("toxics");
                        boolean hasLatency = false;
                        if (toxicsRaw instanceof java.util.List<?> toxicList) {
                            hasLatency = toxicList.stream().anyMatch(t ->
                                t instanceof Map<?,?> m && "latency".equals(m.get("type")));
                        }
                        perProxy.put(entry.getKey(), Map.of("active", hasLatency));
                        if (hasLatency) anyActive = true;
                    }
                    return ApiResponse.ok((Object) Map.of("active", anyActive, "services", perProxy));
                })
                .onErrorResume(e -> Mono.just(ApiResponse.error(502, "ToxiProxy unavailable: " + e.getMessage())));
    }

    // ── Network Reset ────────────────────────────────────────────────────

    @PostMapping("/network-reset/enable")
    public Mono<ApiResponse<Object>> enableNetworkReset(
            @RequestBody NetworkFaultRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        if (!toxiproxyProps.isProxyAllowed(req.proxyName())) {
            return Mono.just(ApiResponse.error(400, "Proxy not in whitelist: " + req.proxyName()));
        }
        Map<String, Object> toxicBody = Map.of(
                "name", req.proxyName() + "_reset_peer",
                "type", "reset_peer",
                "stream", "downstream",
                "toxicity", 1.0,
                "attributes", Map.of("timeout", 0)
        );
        return toxiproxyClient.post()
                .uri("/proxies/{proxy}/toxics", req.proxyName())
                .bodyValue(toxicBody)
                .retrieve()
                .bodyToMono(Object.class)
                .map(ApiResponse::ok)
                .onErrorResume(e -> {
                    log.warn("Enable network reset failed: {}", e.getMessage());
                    return Mono.just(ApiResponse.error(502, "ToxiProxy error: " + e.getMessage()));
                });
    }

    @PostMapping("/network-reset/disable")
    public Mono<ApiResponse<Object>> disableNetworkReset(
            @RequestBody(required = false) NetworkFaultRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        String proxyName = req != null ? req.proxyName() : null;
        if (proxyName == null) {
            return Mono.just(ApiResponse.error(400, "proxyName is required"));
        }
        if (!toxiproxyProps.isProxyAllowed(proxyName)) {
            return Mono.just(ApiResponse.error(400, "Proxy not in whitelist: " + proxyName));
        }
        String toxicName = proxyName + "_reset_peer";
        return toxiproxyClient.delete()
                .uri("/proxies/{proxy}/toxics/{toxic}", proxyName, toxicName)
                .retrieve()
                .bodyToMono(Object.class)
                .defaultIfEmpty(Map.of("removed", toxicName))
                .map(ApiResponse::ok)
                .onErrorResume(e -> {
                    log.warn("Disable network reset failed: {}", e.getMessage());
                    return Mono.just(ApiResponse.ok(Map.of("message", "Toxic may not exist: " + e.getMessage())));
                });
    }

    @GetMapping("/network-reset/status")
    public Mono<ApiResponse<Object>> networkResetStatus(
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return toxiproxyClient.get()
                .uri("/proxies")
                .retrieve()
                .bodyToMono(new org.springframework.core.ParameterizedTypeReference<Map<String, Map<String, Object>>>() {})
                .map(proxies -> {
                    Map<String, Object> perProxy = new java.util.LinkedHashMap<>();
                    boolean anyActive = false;
                    for (var entry : proxies.entrySet()) {
                        Object toxicsRaw = entry.getValue().get("toxics");
                        boolean hasReset = false;
                        if (toxicsRaw instanceof java.util.List<?> toxicList) {
                            hasReset = toxicList.stream().anyMatch(t ->
                                t instanceof Map<?,?> m && "reset_peer".equals(m.get("type")));
                        }
                        perProxy.put(entry.getKey(), Map.of("active", hasReset));
                        if (hasReset) anyActive = true;
                    }
                    return ApiResponse.ok((Object) Map.of("active", anyActive, "services", perProxy));
                })
                .onErrorResume(e -> Mono.just(ApiResponse.error(502, "ToxiProxy unavailable: " + e.getMessage())));
    }
}
