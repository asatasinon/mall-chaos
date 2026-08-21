package com.castrel.chaos.notification.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "notification_inbox_events")
public class NotificationInboxEvent {
    @Id
    private String eventId;
    private String eventType;
    private LocalDateTime receivedAt;
    private LocalDateTime processedAt;
    private String status;
    private String failureReason;
}