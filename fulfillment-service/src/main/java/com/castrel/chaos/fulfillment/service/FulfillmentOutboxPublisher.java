package com.castrel.chaos.fulfillment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.fulfillment.entity.FulfillmentOutboxEvent;
import com.castrel.chaos.fulfillment.repository.FulfillmentOutboxRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class FulfillmentOutboxPublisher {
    private final FulfillmentOutboxRepository repository;
    private final RestTemplate client;
    private final ObjectMapper mapper;
    private final String notificationUrl;
    private final String serviceKey;

    public FulfillmentOutboxPublisher(
            FulfillmentOutboxRepository repository,
            RestTemplateBuilder builder,
            ObjectMapper mapper,
            @Value("${services.notification-url:http://localhost:18090}") String notificationUrl,
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String serviceKey) {
        this.repository = repository;
        this.client = builder.build();
        this.mapper = mapper;
        this.notificationUrl = notificationUrl;
        this.serviceKey = serviceKey;
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        for (FulfillmentOutboxEvent event : repository.findAll().stream()
                .filter(item -> "PENDING".equals(item.getStatus())).limit(50).toList()) {
            event.setStatus("PROCESSING");
            event.setAttempts(event.getAttempts() + 1);
            try {
                JsonNode payload = mapper.readTree(event.getPayload());
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_JSON);
                headers.set("X-Internal-Service-Key", serviceKey);
                var body = java.util.Map.of(
                        "eventId", event.getEventId(),
                        "userId", payload.path("userId").asLong(),
                        "orderNo", payload.path("orderNo").asText(),
                        "trackingNo", payload.path("trackingNo").asText(),
                        "carrier", payload.path("carrier").asText());
                client.postForEntity(notificationUrl + "/internal/notifications/shipping-created",
                        new HttpEntity<>(body, headers), Void.class);
                event.setStatus("PUBLISHED");
            } catch (Exception exception) {
                event.setStatus(event.getAttempts() >= 10 ? "DEAD_LETTER" : "FAILED");
            }
            repository.save(event);
        }
    }
}