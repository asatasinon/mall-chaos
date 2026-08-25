package com.castrel.chaos.gateway.filter;

import com.castrel.chaos.common.security.JwtTokenService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class CustomerAuthenticationGlobalFilter implements GlobalFilter, Ordered {

    private static final Set<String> PROTECTED_PREFIXES = Set.of(
            "/api/me", "/api/cart", "/api/checkout", "/api/orders",
            "/api/payments", "/api/notifications");

    private final JwtTokenService jwtTokenService;
    private final Counter customerApiErrorCounter;

    public CustomerAuthenticationGlobalFilter(
            JwtTokenService jwtTokenService, MeterRegistry meterRegistry) {
        this.jwtTokenService = jwtTokenService;
        this.customerApiErrorCounter = Counter.builder("customer_api_error_total").register(meterRegistry);
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();
        boolean protectedPath = PROTECTED_PREFIXES.stream().anyMatch(path::startsWith);
        ServerWebExchange sanitized = exchange.mutate()
                .request(request -> request.headers(headers -> {
                    headers.remove("X-User-Id");
                    headers.remove("X-User-Role");
                    headers.remove("X-Auth-Actor");
                    headers.remove("X-Downstream-Principal");
                    headers.remove("X-Traffic-Runner-Credential");
                    headers.remove("X-Traffic-Runner-Customer-Id");
                    headers.remove("X-Traffic-Run-Id");
                    headers.remove("X-Traffic-Runner-Action");
                    headers.remove("X-Traffic-Runner-Payment-Strategy");
                }))
                .build();

        if (!protectedPath) return chain.filter(sanitized);

        String authorization = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return unauthorized(exchange);
        }

        try {
            JwtTokenService.JwtPrincipal principal = jwtTokenService.verifyAccessToken(
                    authorization.substring("Bearer ".length()).trim());
            if (!principal.roles().contains("CUSTOMER")) return forbidden(exchange);
            String roles = principal.roles().stream().collect(Collectors.joining(","));
            ServerWebExchange authenticated = sanitized.mutate()
                    .request(request -> request.headers(headers -> {
                        headers.set("X-User-Id", principal.userId().toString());
                        headers.set("X-User-Role", roles);
                        headers.set("X-Auth-Actor", "CUSTOMER");
                        headers.set("X-Downstream-Principal", jwtTokenService.issueDownstreamPrincipal(
                                principal.userId(), "", List.of("CUSTOMER_API")));
                    }))
                    .build();
            return observeCustomerResponse(authenticated, chain.filter(authenticated));
        } catch (IllegalArgumentException exception) {
            return unauthorized(exchange);
        }
    }

    private Mono<Void> unauthorized(ServerWebExchange exchange) {
        customerApiErrorCounter.increment();
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        return exchange.getResponse().setComplete();
    }

    private Mono<Void> forbidden(ServerWebExchange exchange) {
        customerApiErrorCounter.increment();
        exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
        return exchange.getResponse().setComplete();
    }

    private Mono<Void> observeCustomerResponse(ServerWebExchange exchange, Mono<Void> response) {
        return response.doOnSuccess(ignored -> {
            if (exchange.getResponse().getStatusCode() != null
                    && exchange.getResponse().getStatusCode().isError()) {
                customerApiErrorCounter.increment();
            }
        }).doOnError(ignored -> customerApiErrorCounter.increment());
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 10;
    }
}
