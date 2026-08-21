package com.castrel.chaos.order.service;

import com.castrel.chaos.order.entity.OrderOutboxEvent;
import com.castrel.chaos.order.repository.OrderOutboxRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

@Component
public class OrderOutboxPublisher {
    private final OrderOutboxRepository repository;

    public OrderOutboxPublisher(OrderOutboxRepository repository) {
        this.repository = repository;
    }

    @Scheduled(fixedDelayString = "${outbox.publisher.delay-ms:1000}")
    public void publishPending() {
        for (OrderOutboxEvent event : repository.findAll().stream()
                .filter(candidate -> "PENDING".equals(candidate.getStatus())).limit(50).toList()) {
            // Delivery adapters for risk/notification are added per event consumer;
            // claiming here prevents multiple workers from repeatedly claiming the same row.
            event.setStatus("PROCESSING");
            event.setAttempts(event.getAttempts() + 1);
            event.setNextAttemptAt(LocalDateTime.now().plusSeconds(1));
            repository.save(event);
        }
    }
}