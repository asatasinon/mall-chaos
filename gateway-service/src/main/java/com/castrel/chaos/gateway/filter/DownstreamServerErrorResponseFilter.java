package com.castrel.chaos.gateway.filter;

import com.castrel.chaos.common.ApiResponse;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.reactivestreams.Publisher;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.http.server.reactive.ServerHttpResponseDecorator;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@Component
public class DownstreamServerErrorResponseFilter implements org.springframework.cloud.gateway.filter.GlobalFilter, Ordered {

    private static final int RESPONSE_DECORATOR_ORDER = -2;
    private static final String DEFAULT_ERROR_MESSAGE = "Request could not be completed";

    private final ObjectMapper objectMapper;

    public DownstreamServerErrorResponseFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange,
                             org.springframework.cloud.gateway.filter.GatewayFilterChain chain) {
        ServerHttpResponse response = exchange.getResponse();
        ServerHttpResponseDecorator decorated = new ServerHttpResponseDecorator(response) {
            @Override
            public Mono<Void> writeWith(Publisher<? extends DataBuffer> body) {
                HttpStatusCode status = getStatusCode();
                if (status == null || !status.is5xxServerError()) return super.writeWith(body);

                return DataBufferUtils.join(body)
                        .switchIfEmpty(Mono.fromSupplier(() -> bufferFactory().wrap(new byte[0])))
                        .flatMap(dataBuffer -> {
                            DataBufferUtils.release(dataBuffer);
                            try {
                                byte[] convertedBody = objectMapper.writeValueAsBytes(
                                        ApiResponse.error(status.value(), DEFAULT_ERROR_MESSAGE));
                                getHeaders().setContentType(MediaType.APPLICATION_JSON);
                                getHeaders().remove(HttpHeaders.CONTENT_ENCODING);
                                getHeaders().setContentLength(convertedBody.length);
                                return super.writeWith(Mono.just(bufferFactory().wrap(convertedBody)));
                            } catch (JsonProcessingException exception) {
                                return Mono.error(exception);
                            }
                        });
            }

            @Override
            public Mono<Void> writeAndFlushWith(
                    Publisher<? extends Publisher<? extends DataBuffer>> body) {
                HttpStatusCode status = getStatusCode();
                if (status == null || !status.is5xxServerError()) return super.writeAndFlushWith(body);
                return writeWith(Flux.from(body).flatMapSequential(publisher -> publisher));
            }
        };
        return chain.filter(exchange.mutate().response(decorated).build());
    }

    @Override
    public int getOrder() {
        return RESPONSE_DECORATOR_ORDER;
    }
}