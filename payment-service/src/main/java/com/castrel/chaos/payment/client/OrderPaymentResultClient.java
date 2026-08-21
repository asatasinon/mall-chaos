package com.castrel.chaos.payment.client;

import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.payment.dto.PaymentDTO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Map;

@Component
public class OrderPaymentResultClient {
    private final RestTemplate client;

    @Value("${services.order-url:http://localhost:18084}")
    private String orderUrl;

    public OrderPaymentResultClient(RestTemplateBuilder builder) {
        this.client = builder.build();
    }

    public void publish(PaymentDTO payment) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String traceId = TraceContext.getTraceId();
        if (traceId != null) headers.set(TraceContext.TRACE_ID_HEADER, traceId);
        ServletRequestAttributes attrs =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attrs != null) {
            String principal = attrs.getRequest().getHeader("X-Downstream-Principal");
            if (principal != null && !principal.isBlank()) headers.set("X-Downstream-Principal", principal);
        }
        client.postForEntity(orderUrl + "/internal/orders/payment-result", new HttpEntity<>(Map.of(
                "orderNo", payment.getOrderNo(), "paymentNo", payment.getPaymentNo(),
                "status", payment.getStatus(), "resultCode", payment.getResultCode()), headers), Void.class);
    }
}