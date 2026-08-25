package com.castrel.chaos.payment.client;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;

@Component
public class OrderClient {
    private final RestTemplate client;
    private final ObjectMapper objectMapper;

    @Value("${services.order-url:http://localhost:8084}")
    private String orderUrl;

    public OrderClient(RestTemplateBuilder builder, ObjectMapper objectMapper) {
        this.client = builder.build();
        this.objectMapper = objectMapper;
    }

    public OrderData getOrder(Long orderId) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String traceId = TraceContext.getTraceId();
        if (traceId != null) headers.set(TraceContext.TRACE_ID_HEADER, traceId);
        ApiResponse<JsonNode> response = client.exchange(
                orderUrl + "/internal/orders/" + orderId,
                org.springframework.http.HttpMethod.GET,
                new HttpEntity<>(headers),
                new org.springframework.core.ParameterizedTypeReference<ApiResponse<JsonNode>>() {})
            .getBody();
        if (response == null || response.getData() == null) {
            throw new BizException("ORDER_NOT_FOUND", "Order not found: " + orderId);
        }
        try {
            return objectMapper.treeToValue(response.getData(), OrderData.class);
        } catch (Exception exception) {
            throw new IllegalStateException("Invalid order response", exception);
        }
    }

    public record OrderData(Long id, Long userId, String orderNo, BigDecimal totalAmount, String status) {
    }
}
