package com.castrel.chaos.gateway.filter;

import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class InternalDispatchAuthenticationGlobalFilterTest {

    private static final String PATH = "/internal/gateway/inventory/demo-stock/replenish";

    @Test
    void rejectsMissingInternalKey() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(PATH).build());

        new InternalDispatchAuthenticationGlobalFilter("internal-secret")
                .filter(exchange, ignored -> Mono.empty())
                .block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void rejectsCustomerAndBrowserHeadersEvenWithInternalKey() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(PATH)
                .header("X-Internal-Service-Key", "internal-secret")
                .header("Authorization", "Bearer customer-token")
                .header("Origin", "https://shopfront.example")
                .build());

        new InternalDispatchAuthenticationGlobalFilter("internal-secret")
                .filter(exchange, ignored -> Mono.empty())
                .block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void acceptsOnlyAuthenticatedPostAndRemovesInternalHeadersBeforeForwarding() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(PATH)
                .header("X-Internal-Service-Key", "internal-secret")
                .build());
        var forwarded = new AtomicReference<org.springframework.web.server.ServerWebExchange>();
        GatewayFilterChain chain = request -> {
            forwarded.set(request);
            return Mono.empty();
        };

        new InternalDispatchAuthenticationGlobalFilter("internal-secret")
                .filter(exchange, chain)
                .block();

        assertThat(forwarded.get()).isNotNull();
        assertThat(forwarded.get().getRequest().getHeaders().getFirst("X-Internal-Service-Key"))
                .isNull();
    }
}