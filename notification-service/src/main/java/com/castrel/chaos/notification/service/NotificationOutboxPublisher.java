package com.castrel.chaos.notification.service;

import com.castrel.chaos.notification.entity.NotificationOutboxEvent;
import com.castrel.chaos.notification.repository.NotificationOutboxRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

import java.time.LocalDateTime;

@Component
public class NotificationOutboxPublisher {
    private final NotificationOutboxRepository repository;
    private final Counter publishedCounter;
    private final Counter failedCounter;

    public NotificationOutboxPublisher(NotificationOutboxRepository repository, MeterRegistry meterRegistry) {
        this.repository = repository;
        this.publishedCounter = Counter.builder("notification.outbox.published.count").register(meterRegistry);
        this.failedCounter = Counter.builder("notification.outbox.failed.count").register(meterRegistry);
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        LocalDateTime now = LocalDateTime.now();
        for (NotificationOutboxEvent event : repository.findReady(now, PageRequest.of(0, 50))) {
            if (repository.claim(event.getId(), now) == 0) {
                continue;
            }
            try {
                event.setStatus("PUBLISHED");
                event.setPublishedAt(LocalDateTime.now());
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
