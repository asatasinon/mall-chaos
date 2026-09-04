package com.castrel.chaos.gateway.filter;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Set;

@Component
public class InternalDispatchAuthenticationGlobalFilter implements GlobalFilter, Ordered {

    private static final Set<String> INTERNAL_PATHS = Set.of(
            "/internal/gateway/promotions/demo-coupons/replenish",
            "/internal/gateway/inventory/demo-stock/replenish",
            "/internal/gateway/inventory-reset/plan",
            "/internal/gateway/inventory-reset",
            "/internal/gateway/operations/prepare",
            "/internal/gateway/operations/release",
            "/internal/gateway/operations/cleanup",
            "/internal/gateway/operations/cleanup-all",
            "/internal/gateway/inventory/availability",
            "/internal/gateway/inventory/reservations/summary",
            "/internal/gateway/promotion/consistency",
            "/internal/gateway/notification/storage/append",
            "/internal/gateway/notification/restart");

    private final String internalServiceKey;

    public InternalDispatchAuthenticationGlobalFilter(
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String internalServiceKey) {
        this.internalServiceKey = internalServiceKey;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        if (!INTERNAL_PATHS.contains(exchange.getRequest().getURI().getPath())) {
            return chain.filter(exchange);
        }

        HttpHeaders headers = exchange.getRequest().getHeaders();
        String suppliedKey = headers.getFirst("X-Internal-Service-Key");
        boolean validKey = !internalServiceKey.isBlank()
                && suppliedKey != null
                && MessageDigest.isEqual(
                        internalServiceKey.getBytes(StandardCharsets.UTF_8),
                        suppliedKey.getBytes(StandardCharsets.UTF_8));
        if (!validKey || !HttpMethod.POST.equals(exchange.getRequest().getMethod())
                || !exchange.getRequest().getQueryParams().isEmpty()
                || headers.containsKey(HttpHeaders.AUTHORIZATION)
                || headers.containsKey("Origin")
                || headers.containsKey("Referer")
                || hasClientSuppliedIdentity(headers)) {
            return reject(exchange, validKey ? HttpStatus.FORBIDDEN : HttpStatus.UNAUTHORIZED);
        }

        ServerWebExchange sanitized = exchange.mutate()
                .request(request -> request.headers(requestHeaders -> {
                    requestHeaders.remove("X-Internal-Service-Key");
                    requestHeaders.remove("X-User-Id");
                    requestHeaders.remove("X-User-Role");
                    requestHeaders.remove("X-Auth-Actor");
                    requestHeaders.remove("X-Downstream-Principal");
                    requestHeaders.remove("X-Operation-Run-Id");
                    requestHeaders.remove("X-Operation-Run-Expires-At");
                    requestHeaders.remove("X-Operation-Run-Fencing-Token");
                    requestHeaders.remove("X-Operation-Run-Idempotency-Key");
                }))
                .build();
        return chain.filter(sanitized);
    }

    private boolean hasClientSuppliedIdentity(HttpHeaders headers) {
        return headers.containsKey("X-Traffic-Runner-Credential")
                || headers.containsKey("X-Traffic-Runner-Customer-Id")
                || headers.containsKey("X-Traffic-Run-Id")
                || headers.containsKey("X-Traffic-Runner-Action")
                || headers.containsKey("X-Traffic-Runner-Payment-Strategy")
                || headers.containsKey("X-Downstream-Principal")
                || headers.containsKey("X-Operation-Run-Id")
                || headers.containsKey("X-Operation-Run-Expires-At")
                || headers.containsKey("X-Operation-Run-Fencing-Token")
                || headers.containsKey("X-Operation-Run-Idempotency-Key")
                || headers.containsKey("X-User-Id")
                || headers.containsKey("X-User-Role")
                || headers.containsKey("X-Auth-Actor");
    }

    private Mono<Void> reject(ServerWebExchange exchange, HttpStatus status) {
        exchange.getResponse().setStatusCode(status);
        return exchange.getResponse().setComplete();
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 5;
    }
}