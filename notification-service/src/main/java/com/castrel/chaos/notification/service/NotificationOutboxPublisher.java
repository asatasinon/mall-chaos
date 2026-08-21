package com.castrel.chaos.notification.service;

import com.castrel.chaos.notification.entity.NotificationOutboxEvent;
import com.castrel.chaos.notification.repository.NotificationOutboxRepository;
import com.castrel.chaos.common.event.EventEnvelopeCodec;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

import java.time.LocalDateTime;

@Component
public class NotificationOutboxPublisher {
    private final NotificationOutboxRepository repository;
    private final ObjectMapper mapper;
    private final Counter publishedCounter;
    private final Counter failedCounter;
    private final Timer publishLatency;

    public NotificationOutboxPublisher(NotificationOutboxRepository repository, ObjectMapper mapper,
                                       MeterRegistry meterRegistry) {
        this.repository = repository;
        this.mapper = mapper;
        this.publishedCounter = Counter.builder("notification.outbox.published.count").register(meterRegistry);
        this.failedCounter = Counter.builder("notification.outbox.failed.count").register(meterRegistry);
        this.publishLatency = Timer.builder("outbox.publish.latency")
            .tag("service", "notification")
            .register(meterRegistry);
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        LocalDateTime now = LocalDateTime.now();
        for (NotificationOutboxEvent event : repository.findReady(now, PageRequest.of(0, 50))) {
            if (repository.claim(event.getId(), now) == 0) {
                continue;
            }
            try {
                EventEnvelopeCodec.decode(mapper,
                        event.getEventId(), event.getEventType(), event.getAggregateId(),
                        event.getAggregateVersion(), event.getPayload(), event.getOccurredAt(),
                        event.getSchemaVersion(), event.getTraceId(), null);
                event.setStatus("PUBLISHED");
                event.setPublishedAt(LocalDateTime.now());
                publishLatency.record(java.time.Duration.between(event.getOccurredAt(), event.getPublishedAt()));
                publishedCounter.increment();
            } catch (Exception exception) {
                event.setStatus(event.getAttempts() >= 10 ? "DEAD_LETTER" : "FAILED");
                event.setNextAttemptAt(LocalDateTime.now().plusSeconds(Math.min(event.getAttempts(), 30)));
                failedCounter.increment();
            }
            event.setCreatedAt(event.getCreatedAt() == null ? LocalDateTime.now() : event.getCreatedAt());
            repository.save(event);
        }
    }
}
