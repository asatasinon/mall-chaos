package com.castrel.chaos.order.service;

import com.castrel.chaos.order.entity.OrderOutboxEvent;
import com.castrel.chaos.order.repository.OrderOutboxRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestTemplate;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.time.LocalDateTime;

@Component
public class OrderOutboxPublisher {
    private final OrderOutboxRepository repository;
    private final RestTemplate client;
    private final ObjectMapper objectMapper;
    private final String riskUrl;
    private final String notificationUrl;
    private final String serviceKey;

    public OrderOutboxPublisher(
            OrderOutboxRepository repository,
            RestTemplateBuilder builder,
            ObjectMapper objectMapper,
            @Value("${services.risk-url:http://localhost:18088}") String riskUrl,
            @Value("${services.notification-url:http://localhost:18090}") String notificationUrl,
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String serviceKey) {
        this.repository = repository;
        this.client = builder.build();
        this.objectMapper = objectMapper;
        this.riskUrl = riskUrl;
        this.notificationUrl = notificationUrl;
        this.serviceKey = serviceKey;
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        for (OrderOutboxEvent event : repository.findAll().stream()
                .filter(candidate -> "PENDING".equals(candidate.getStatus())).limit(50).toList()) {
            event.setStatus("PROCESSING");
            event.setAttempts(event.getAttempts() + 1);
            repository.save(event);
            try {
                deliver(event);
                event.setStatus("PUBLISHED");
                event.setPublishedAt(LocalDateTime.now());
            } catch (Exception exception) {
                event.setStatus(event.getAttempts() >= 10 ? "DEAD_LETTER" : "FAILED");
                event.setNextAttemptAt(LocalDateTime.now().plusSeconds(1));
            }
            repository.save(event);
        }
    }

    private void deliver(OrderOutboxEvent event) throws Exception {
        JsonNode payload = objectMapper.readTree(event.getPayload());
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Internal-Service-Key", serviceKey);
        if ("ORDER_PAID".equals(event.getEventType())) {
            client.postForEntity(riskUrl + "/internal/risk/events/order-paid",
                    new HttpEntity<>(payload, headers), Void.class);
        }
        if ("ORDER_PAID".equals(event.getEventType()) || "ORDER_PAYMENT_FAILED".equals(event.getEventType())) {
            boolean success = "ORDER_PAID".equals(event.getEventType());
            var body = java.util.Map.of(
                    "userId", payload.path("userId").asLong(),
                    "orderNo", payload.path("orderNo").asText(),
                    "success", success,
                    "amount", payload.path("totalAmount").decimalValue());
            client.postForEntity(notificationUrl + "/internal/notifications/payment-result",
                    new HttpEntity<>(body, headers), Void.class);
        }
    }
}