package com.castrel.chaos.payment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeCodec;
import com.castrel.chaos.payment.entity.PaymentOutboxEvent;
import com.castrel.chaos.payment.repository.PaymentOutboxRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.MeterRegistry;

import java.time.LocalDateTime;
import java.time.Duration;

@Component
public class PaymentOutboxPublisher {
    private final PaymentOutboxRepository repository;
    private final ObjectMapper objectMapper;
    private final PaymentResultDelivery delivery;
    private final Timer publishLatency;

    public PaymentOutboxPublisher(PaymentOutboxRepository repository, ObjectMapper objectMapper,
                                  PaymentResultDelivery delivery, MeterRegistry meterRegistry) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.delivery = delivery;
        this.publishLatency = Timer.builder("outbox.publish.latency")
            .tag("service", "payment")
            .register(meterRegistry);
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        LocalDateTime now = LocalDateTime.now();
        for (PaymentOutboxEvent event : repository.findReady(now, PageRequest.of(0, 50))) {
            if (repository.claim(event.getId(), now) == 0) {
                continue;
            }
            event.setStatus("PROCESSING");
            event.setAttempts((event.getAttempts() == null ? 0 : event.getAttempts()) + 1);
            try {
                EventEnvelope<JsonNode> envelope = EventEnvelopeCodec.decode(objectMapper,
                    event.getEventId(), event.getEventType(), event.getAggregateId(),
                    event.getAggregateVersion(), event.getPayload(), event.getOccurredAt(),
                    event.getSchemaVersion(), event.getTraceId(), event.getTrafficRunId());
                delivery.deliver(envelope);
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
}