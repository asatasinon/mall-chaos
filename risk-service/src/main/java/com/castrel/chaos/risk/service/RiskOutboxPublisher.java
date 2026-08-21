package com.castrel.chaos.risk.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.risk.entity.RiskOutboxEvent;
import com.castrel.chaos.risk.repository.RiskOutboxRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.Map;

@Component
public class RiskOutboxPublisher {
    private final RiskOutboxRepository repository;
    private final RestTemplate client;
    private final ObjectMapper mapper;
    private final String fulfillmentUrl;
    private final String orderUrl;
    private final String serviceKey;
    private final Counter publishedCounter;
    private final Counter failedCounter;

    public RiskOutboxPublisher(
            RiskOutboxRepository repository,
            RestTemplateBuilder builder,
            ObjectMapper mapper,
            @Value("${services.fulfillment-url:http://localhost:18089}") String fulfillmentUrl,
            @Value("${services.order-url:http://localhost:18084}") String orderUrl,
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String serviceKey,
            MeterRegistry meterRegistry) {
        this.repository = repository;
        this.client = builder.build();
        this.mapper = mapper;
        this.fulfillmentUrl = fulfillmentUrl;
        this.orderUrl = orderUrl;
        this.serviceKey = serviceKey;
        this.publishedCounter = Counter.builder("risk.outbox.published.count").register(meterRegistry);
        this.failedCounter = Counter.builder("risk.outbox.failed.count").register(meterRegistry);
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        LocalDateTime now = LocalDateTime.now();
        for (RiskOutboxEvent event : repository.findReady(now, PageRequest.of(0, 50))) {
            if (repository.claim(event.getId(), now) == 0) {
                continue;
            }
            repository.save(event);
            try {
                JsonNode payload = mapper.readTree(event.getPayload());
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_JSON);
                headers.set("X-Internal-Service-Key", serviceKey);
                if ("POST_PAYMENT_RISK_PASSED".equals(event.getEventType())) {
                    client.postForEntity(fulfillmentUrl + "/internal/fulfillments/events/risk-passed",
                            new HttpEntity<>(payload, headers), Void.class);
                } else if ("POST_PAYMENT_RISK_REJECTED".equals(event.getEventType())) {
                    client.postForEntity(orderUrl + "/internal/orders/risk-rejected",
                            new HttpEntity<>(Map.of("orderNo", payload.path("orderNo").asText(),
                                    "reason", payload.path("result").path("reason").asText()), headers), Void.class);
                }
                event.setStatus("PUBLISHED");
                event.setPublishedAt(java.time.LocalDateTime.now());
                publishedCounter.increment();
            } catch (Exception exception) {
                event.setStatus(event.getAttempts() >= 10 ? "DEAD_LETTER" : "FAILED");
                event.setNextAttemptAt(java.time.LocalDateTime.now().plusSeconds(Math.min(event.getAttempts(), 30)));
                failedCounter.increment();
            }
            repository.save(event);
        }
    }
}