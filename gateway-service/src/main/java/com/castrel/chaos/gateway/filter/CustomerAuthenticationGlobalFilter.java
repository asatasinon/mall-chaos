package com.castrel.chaos.gateway.filter;

import com.castrel.chaos.common.security.JwtTokenService;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.Set;
import java.util.List;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;

@Component
public class CustomerAuthenticationGlobalFilter implements GlobalFilter, Ordered {

    private static final Set<String> PROTECTED_PREFIXES = Set.of(
            "/api/me", "/api/cart", "/api/checkout", "/api/orders",
            "/api/payments", "/api/notifications");
        private static final Map<String, Set<String>> RUNNER_ACTIONS_BY_PREFIX = Map.of(
            "/api/products", Set.of("BROWSE_PRODUCT", "SEARCH_CATALOG"),
            "/api/cart", Set.of("ADD_CART_ITEM", "UPDATE_CART_ITEM", "CHECKOUT"),
            "/api/checkout", Set.of("CHECKOUT"),
            "/api/orders", Set.of("PAYMENT_CONFIRM", "CANCEL_PENDING_ORDER", "QUERY_ORDER", "QUERY_SHIPMENT"),
            "/api/payments", Set.of("PAYMENT_CONFIRM"));

    private final JwtTokenService jwtTokenService;
    private final Counter customerApiErrorCounter;
    private final Set<Long> runnerCustomerIds;

    public CustomerAuthenticationGlobalFilter(
            JwtTokenService jwtTokenService,
            MeterRegistry meterRegistry,
            @Value("${castrel.security.runner.customer-ids:1,2}") String runnerCustomerIds) {
        this.jwtTokenService = jwtTokenService;
        this.customerApiErrorCounter = Counter.builder("customer_api_error_total").register(meterRegistry);
        this.runnerCustomerIds = parseCustomerIds(runnerCustomerIds);
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();
        boolean protectedPath = PROTECTED_PREFIXES.stream().anyMatch(path::startsWith);
        String runnerCredential = exchange.getRequest().getHeaders().getFirst("X-Traffic-Runner-Credential");

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

        if (!protectedPath && (runnerCredential == null || runnerCredential.isBlank())) {
            return chain.filter(sanitized);
        }

        String authorization = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (runnerCredential != null && !runnerCredential.isBlank()) {
            try {
                JwtTokenService.RunnerPrincipal runner = jwtTokenService.verifyRunnerCredential(runnerCredential);
                if (!runner.scopes().contains("customer_api")) {
                    return unauthorized(exchange);
                }
                Long customerId = requestedRunnerCustomerId(exchange, runner);
                if (customerId == null || !runner.customerId().equals(customerId)
                        || !runnerCustomerIds.contains(customerId)) {
                    return forbidden(exchange);
                }
                String action = exchange.getRequest().getHeaders().getFirst("X-Traffic-Runner-Action");
                if (!isAllowedRunnerAction(path, action, runner.scopes())) {
                    return forbidden(exchange);
                }
                String trafficRunId = exchange.getRequest().getHeaders().getFirst("X-Traffic-Run-Id");
                ServerWebExchange authenticated = sanitized.mutate()
                        .request(request -> request.headers(headers -> {
                            headers.set("X-User-Id", customerId.toString());
                            headers.set("X-User-Role", "CUSTOMER");
                            headers.set("X-Auth-Actor", "TRAFFIC_RUNNER");
                            headers.set("X-Downstream-Principal", jwtTokenService.issueDownstreamPrincipal(
                                    customerId, trafficRunId == null ? "" : trafficRunId, runner.scopes()));
                        }))
                        .build();
                return observeCustomerResponse(authenticated, chain.filter(authenticated));
            } catch (IllegalArgumentException exception) {
                return unauthorized(exchange);
            }
        }
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return unauthorized(exchange);
        }

        try {
            JwtTokenService.JwtPrincipal principal = jwtTokenService.verifyAccessToken(
                    authorization.substring("Bearer ".length()).trim());
            if (!principal.roles().contains("CUSTOMER")) {
                return forbidden(exchange);
            }
            String roles = principal.roles().stream().collect(Collectors.joining(","));
            ServerWebExchange authenticated = sanitized.mutate()
                    .request(request -> request.headers(headers -> {
                        headers.set("X-User-Id", principal.userId().toString());
                        headers.set("X-User-Role", roles);
                        headers.set("X-Auth-Actor", "CUSTOMER");
                        headers.set("X-Downstream-Principal",
                            jwtTokenService.issueDownstreamPrincipal(
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

    private Long requestedRunnerCustomerId(ServerWebExchange exchange, JwtTokenService.RunnerPrincipal runner) {
        String requested = exchange.getRequest().getHeaders().getFirst("X-Traffic-Runner-Customer-Id");
        if (requested == null || requested.isBlank()) return runner.customerId();
        try {
            return Long.valueOf(requested);
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private boolean isAllowedRunnerAction(String path, String action, List<String> scopes) {
        if (action == null || action.isBlank() || !scopes.contains(action)) {
            return false;
        }
        Optional<Set<String>> allowed = RUNNER_ACTIONS_BY_PREFIX.entrySet().stream()
                .filter(entry -> path.startsWith(entry.getKey()))
                .map(Map.Entry::getValue)
                .findFirst();
        return allowed.isPresent() && allowed.get().contains(action);
    }

    private Set<Long> parseCustomerIds(String value) {
        Set<Long> result = new HashSet<>();
        Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(item -> !item.isBlank())
                .forEach(item -> {
                    try {
                        result.add(Long.valueOf(item));
                    } catch (NumberFormatException ignored) {
                    }
                });
        return Set.copyOf(result);
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