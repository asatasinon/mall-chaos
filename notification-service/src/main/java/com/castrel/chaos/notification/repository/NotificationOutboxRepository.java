package com.castrel.chaos.notification.repository;

import com.castrel.chaos.notification.entity.NotificationOutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationOutboxRepository extends JpaRepository<NotificationOutboxEvent, Long> {
}