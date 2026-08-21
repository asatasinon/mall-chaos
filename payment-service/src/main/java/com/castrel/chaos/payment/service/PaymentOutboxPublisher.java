package com.castrel.chaos.payment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeCodec;
import com.castrel.chaos.payment.entity.PaymentOutboxEvent;
import com.castrel.chaos.payment.repository.PaymentOutboxRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

@Component
public class PaymentOutboxPublisher {
    private final PaymentOutboxRepository repository;
    private final ObjectMapper objectMapper;
    private final PaymentResultDelivery delivery;

    public PaymentOutboxPublisher(PaymentOutboxRepository repository, ObjectMapper objectMapper,
                                  PaymentResultDelivery delivery) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.delivery = delivery;
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        for (PaymentOutboxEvent event : repository.findTop50ByStatusOrderByCreatedAtAsc("PENDING")) {
            try {
                EventEnvelope<JsonNode> envelope = EventEnvelopeCodec.decode(objectMapper,
                    event.getEventId(), event.getEventType(), event.getAggregateId(),
                    event.getAggregateVersion(), event.getPayload(), event.getOccurredAt(),
                    event.getSchemaVersion(), event.getTraceId(), event.getTrafficRunId());
                delivery.deliver(envelope.getPayload());
                event.setStatus("PUBLISHED");
                event.setPublishedAt(LocalDateTime.now());
            } catch (Exception exception) {
                event.setAttempts(event.getAttempts() + 1);
                event.setStatus(event.getAttempts() >= 10 ? "DEAD_LETTER" : "FAILED");
            }
            repository.save(event);
        }
    }
}