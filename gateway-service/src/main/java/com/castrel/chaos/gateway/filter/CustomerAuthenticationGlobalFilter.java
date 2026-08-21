package com.castrel.chaos.gateway.filter;

import com.castrel.chaos.common.security.JwtTokenService;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.Set;
import java.util.stream.Collectors;

@Component
public class CustomerAuthenticationGlobalFilter implements GlobalFilter, Ordered {

    private static final Set<String> PROTECTED_PREFIXES = Set.of(
            "/api/users", "/api/addresses", "/api/cart", "/api/checkout", "/api/orders",
            "/api/payments", "/api/fulfillments", "/api/notifications");

    private final JwtTokenService jwtTokenService;

    public CustomerAuthenticationGlobalFilter(JwtTokenService jwtTokenService) {
        this.jwtTokenService = jwtTokenService;
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
                }))
                .build();

        if (!protectedPath) {
            return chain.filter(sanitized);
        }

        String authorization = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return unauthorized(exchange);
        }

        try {
            JwtTokenService.JwtPrincipal principal = jwtTokenService.verifyAccessToken(
                    authorization.substring("Bearer ".length()).trim());
            String roles = principal.roles().stream().collect(Collectors.joining(","));
            ServerWebExchange authenticated = sanitized.mutate()
                    .request(request -> request.headers(headers -> {
                        headers.set("X-User-Id", principal.userId().toString());
                        headers.set("X-User-Role", roles);
                        headers.set("X-Auth-Actor", "CUSTOMER");
                    }))
                    .build();
            return chain.filter(authenticated);
        } catch (IllegalArgumentException exception) {
            return unauthorized(exchange);
        }
    }

    private Mono<Void> unauthorized(ServerWebExchange exchange) {
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        return exchange.getResponse().setComplete();
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 10;
    }
}