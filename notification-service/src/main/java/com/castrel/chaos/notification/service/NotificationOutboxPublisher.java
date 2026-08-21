package com.castrel.chaos.notification.service;

import com.castrel.chaos.notification.entity.NotificationOutboxEvent;
import com.castrel.chaos.notification.repository.NotificationOutboxRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

@Component
public class NotificationOutboxPublisher {
    private final NotificationOutboxRepository repository;

    public NotificationOutboxPublisher(NotificationOutboxRepository repository) {
        this.repository = repository;
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        for (NotificationOutboxEvent event : repository.findAll().stream()
                .filter(item -> ("PENDING".equals(item.getStatus()) || "FAILED".equals(item.getStatus()))
                    && item.getAttempts() < 10
                    && (item.getNextAttemptAt() == null || !item.getNextAttemptAt().isAfter(LocalDateTime.now())))
                .limit(50).toList()) {
            event.setStatus("PROCESSING");
            event.setAttempts(event.getAttempts() + 1);
            try {
                event.setStatus("PUBLISHED");
                event.setPublishedAt(LocalDateTime.now());
            } catch (Exception exception) {
                event.setStatus(event.getAttempts() >= 10 ? "DEAD_LETTER" : "FAILED");
                event.setNextAttemptAt(LocalDateTime.now().plusSeconds(Math.min(event.getAttempts(), 30)));
            }
            event.setCreatedAt(event.getCreatedAt() == null ? LocalDateTime.now() : event.getCreatedAt());
            repository.save(event);
        }
    }
}
