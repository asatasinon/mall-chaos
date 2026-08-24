package com.castrel.chaos.fulfillment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeCodec;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.fulfillment.entity.FulfillmentOutboxEvent;
import com.castrel.chaos.fulfillment.repository.FulfillmentOutboxRepository;
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
import io.micrometer.core.instrument.Timer;
import org.springframework.web.client.RestTemplate;

@Component
public class FulfillmentOutboxPublisher {
    private final FulfillmentOutboxRepository repository;
    private final RestTemplate client;
    private final ObjectMapper mapper;
    private final String notificationUrl;
    private final String serviceKey;
    private final Counter publishedCounter;
    private final Counter failedCounter;
    private final Timer publishLatency;

    public FulfillmentOutboxPublisher(
            FulfillmentOutboxRepository repository,
            RestTemplateBuilder builder,
            ObjectMapper mapper,
            @Value("${services.notification-url:http://localhost:18090}") String notificationUrl,
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String serviceKey,
            MeterRegistry meterRegistry) {
        this.repository = repository;
        this.client = builder.build();
        this.mapper = mapper;
        this.notificationUrl = notificationUrl;
        this.serviceKey = serviceKey;
        this.publishedCounter = Counter.builder("fulfillment.outbox.published.count").register(meterRegistry);
        this.failedCounter = Counter.builder("fulfillment.outbox.failed.count").register(meterRegistry);
        this.publishLatency = Timer.builder("outbox.publish.latency")
            .tag("service", "fulfillment")
            .register(meterRegistry);
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        for (FulfillmentOutboxEvent event : repository.findReady(now, PageRequest.of(0, 50))) {
            if (repository.claim(event.getId(), now) == 0) {
                continue;
            }
            event.setNextAttemptAt(now.plusSeconds(60));
            try {
                EventEnvelope<JsonNode> envelope = EventEnvelopeCodec.decode(mapper,
                    event.getEventId(), event.getEventType(), event.getAggregateId(),
                    event.getAggregateVersion(), event.getPayload(), event.getOccurredAt(),
                    event.getSchemaVersion(), event.getTraceId(), null);
                JsonNode payload = envelope.getPayload();
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_JSON);
                headers.set("X-Internal-Service-Key", serviceKey);
                if (envelope.getTraceId() != null && !envelope.getTraceId().isBlank()) {
                    headers.set(TraceContext.TRACE_ID_HEADER, envelope.getTraceId());
                }
                client.postForEntity(notificationUrl + "/internal/notifications/shipping-created",
                    new HttpEntity<>(envelope, headers), Void.class);
                event.setStatus("PUBLISHED");
                event.setPublishedAt(java.time.LocalDateTime.now());
                publishLatency.record(java.time.Duration.between(event.getOccurredAt(), event.getPublishedAt()));
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