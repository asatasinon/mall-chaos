package com.castrel.chaos.notification.repository;

import com.castrel.chaos.notification.entity.NotificationInboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationInboxRepository extends JpaRepository<NotificationInboxEvent, String> {
}