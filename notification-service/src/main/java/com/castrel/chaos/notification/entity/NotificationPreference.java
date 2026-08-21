package com.castrel.chaos.notification.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "notification_preferences")
public class NotificationPreference {
    @Id
    @Column(name = "customer_id")
    private Long customerId;
    @Column(nullable = false)
    private Boolean email = true;
    @Column(name = "in_app", nullable = false)
    private Boolean inApp = true;
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}