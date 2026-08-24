package com.castrel.chaos.order.service;

import com.castrel.chaos.order.entity.OrderOutboxEvent;
import com.castrel.chaos.order.repository.OrderOutboxRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestTemplate;
import io.micrometer.core.instrument.MeterRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeCodec;
import io.micrometer.core.instrument.Timer;

import java.time.LocalDateTime;
import java.time.Duration;

@Component
public class OrderOutboxPublisher {
    private final OrderOutboxRepository repository;
    private final RestTemplate client;
    private final ObjectMapper objectMapper;
    private final String riskUrl;
    private final String notificationUrl;
    private final String serviceKey;
    private final Timer publishLatency;

    public OrderOutboxPublisher(
            OrderOutboxRepository repository,
            RestTemplateBuilder builder,
            ObjectMapper objectMapper,
            @Value("${services.risk-url:http://localhost:18088}") String riskUrl,
            @Value("${services.notification-url:http://localhost:18090}") String notificationUrl,
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String serviceKey,
            MeterRegistry meterRegistry) {
        this.repository = repository;
        this.client = builder.build();
        this.objectMapper = objectMapper;
        this.riskUrl = riskUrl;
        this.notificationUrl = notificationUrl;
        this.serviceKey = serviceKey;
        this.publishLatency = Timer.builder("outbox.publish.latency")
            .tag("service", "order")
            .register(meterRegistry);
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        LocalDateTime now = LocalDateTime.now();
        for (OrderOutboxEvent event : repository.findReady(now, PageRequest.of(0, 50))) {
            if (repository.claim(event.getId(), now) == 0) {
                continue;
            }
            event.setStatus("PROCESSING");
            event.setAttempts((event.getAttempts() == null ? 0 : event.getAttempts()) + 1);
            event.setNextAttemptAt(now.plusSeconds(60));
            repository.save(event);
            try {
                deliver(event);
                event.setStatus("PUBLISHED");
                event.setPublishedAt(LocalDateTime.now());
                publishLatency.record(Duration.between(event.getOccurredAt(), event.getPublishedAt()));
            } catch (Exception exception) {
                event.setStatus(event.getAttempts() >= 10 ? "DEAD_LETTER" : "FAILED");
                event.setNextAttemptAt(LocalDateTime.now().plusSeconds(Math.min(event.getAttempts(), 30)));
            }
            repository.save(event);
        }
    }

    private void deliver(OrderOutboxEvent event) throws Exception {
        EventEnvelope<JsonNode> envelope = EventEnvelopeCodec.decode(objectMapper,
            event.getEventId(), event.getEventType(), event.getAggregateId(),
            event.getAggregateVersion(), event.getPayload(), event.getOccurredAt(),
            event.getSchemaVersion(), event.getTraceId(), event.getTrafficRunId());
        JsonNode payload = envelope.getPayload();
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Internal-Service-Key", serviceKey);
        if ("ORDER_PAID".equals(event.getEventType())) {
            client.postForEntity(riskUrl + "/internal/risk/events/order-paid",
                    new HttpEntity<>(envelope, headers), Void.class);
        }
        if ("ORDER_PAID".equals(event.getEventType()) || "ORDER_PAYMENT_FAILED".equals(event.getEventType())) {
            client.postForEntity(notificationUrl + "/internal/notifications/payment-result",
                new HttpEntity<>(envelope, headers), Void.class);
        }
    }
}