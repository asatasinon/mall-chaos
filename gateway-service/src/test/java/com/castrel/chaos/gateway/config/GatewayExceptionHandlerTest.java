package com.castrel.chaos.gateway.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GatewayExceptionHandlerTest {

    private final GatewayExceptionHandler handler = new GatewayExceptionHandler(new ObjectMapper());

    @Test
    void convertsServerErrorToApiResponse() throws Exception {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/products").build());

        handler.handle(exchange, new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Target unavailable"))
                .block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        JsonNode body = new ObjectMapper().readTree(responseBody(exchange));
        assertThat(body.get("code").asInt()).isEqualTo(503);
        assertThat(body.get("message").asText()).isEqualTo("Target unavailable");
        assertThat(body.get("data").isNull()).isTrue();
    }

    @Test
    void leavesClientErrorsToTheDefaultWebFluxHandler() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/products").build());
        var exception = new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid request");

        assertThatThrownBy(() -> handler.handle(exchange, exception).block())
            .isSameAs(exception);
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