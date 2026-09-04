package com.castrel.chaos.gateway.filter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.NettyWriteResponseFilter;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class DownstreamServerErrorResponseFilterTest {

    @Test
    void decoratesResponseBeforeNettyWritesIt() {
        assertThat(new DownstreamServerErrorResponseFilter(new ObjectMapper()).getOrder())
                .isLessThan(NettyWriteResponseFilter.WRITE_RESPONSE_FILTER_ORDER);
    }

    @Test
    void convertsProxiedServerErrorBodyToApiResponse() throws Exception {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/products").build());
        GatewayFilterChain chain = filteredExchange -> {
            filteredExchange.getResponse().setStatusCode(HttpStatus.INTERNAL_SERVER_ERROR);
            return filteredExchange.getResponse().writeWith(Mono.just(
                    filteredExchange.getResponse().bufferFactory().wrap("internal details".getBytes(StandardCharsets.UTF_8))));
        };

        new DownstreamServerErrorResponseFilter(new ObjectMapper()).filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        JsonNode body = new ObjectMapper().readTree(responseBody(exchange));
        assertThat(body.get("code").asInt()).isEqualTo(500);
        assertThat(body.get("message").asText()).isEqualTo("Request could not be completed");
        assertThat(body.get("data").isNull()).isTrue();
    }

    private String responseBody(MockServerWebExchange exchange) {
        var buffer = exchange.getResponse().getBody().blockFirst();
        assertThat(buffer).isNotNull();
        try {
            return buffer.toString(StandardCharsets.UTF_8);
        } finally {
            DataBufferUtils.release(buffer);
        }
    }
}