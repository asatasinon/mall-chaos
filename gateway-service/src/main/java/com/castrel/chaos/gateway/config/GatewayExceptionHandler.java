package com.castrel.chaos.gateway.config;

import com.castrel.chaos.common.ApiResponse;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.boot.web.reactive.error.ErrorWebExceptionHandler;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.net.SocketTimeoutException;
import java.util.concurrent.TimeoutException;

@Component
@Order(-2)
public class GatewayExceptionHandler implements ErrorWebExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GatewayExceptionHandler.class);
    private static final String DEFAULT_ERROR_MESSAGE = "Request could not be completed";

    private final ObjectMapper objectMapper;

    public GatewayExceptionHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable exception) {
        if (exchange.getResponse().isCommitted()) return Mono.error(exception);

        HttpStatusCode status = statusOf(exception);
        if (!status.is5xxServerError()) return Mono.error(exception);

        log.error("Gateway request failed: {}", exception.getMessage(), exception);
        exchange.getResponse().setStatusCode(status);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        exchange.getResponse().getHeaders().remove(HttpHeaders.CONTENT_LENGTH);
        try {
            byte[] body = objectMapper.writeValueAsBytes(
                    ApiResponse.error(status.value(), messageOf(exception)));
            return exchange.getResponse().writeWith(
                    Mono.just(exchange.getResponse().bufferFactory().wrap(body)));
        } catch (JsonProcessingException serializationException) {
            return Mono.error(serializationException);
        }
    }

    private HttpStatusCode statusOf(Throwable exception) {
        if (exception instanceof ResponseStatusException responseStatusException) {
            return responseStatusException.getStatusCode();
        }
        if (exception instanceof WebClientResponseException webClientException) {
            return webClientException.getStatusCode();
        }
        if (exception instanceof WebClientRequestException
                || exception instanceof SocketTimeoutException
                || exception instanceof TimeoutException) {
            return HttpStatus.BAD_GATEWAY;
        }
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }

    private String messageOf(Throwable exception) {
        if (exception instanceof ResponseStatusException responseStatusException
                && responseStatusException.getReason() != null
                && !responseStatusException.getReason().isBlank()) {
            return responseStatusException.getReason();
        }
        return DEFAULT_ERROR_MESSAGE;
    }
}