package com.castrel.chaos.notification.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "customer_notifications")
public class CustomerNotification {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "customer_id", nullable = false)
    private Long customerId;
    @Column(name = "event_id")
    private String eventId;
    @Column(name = "event_type", nullable = false)
    private String eventType;
    @Column(nullable = false)
    private String title;
    @Column(nullable = false)
    private String body;
    @Column(name = "is_read", nullable = false)
    private Boolean read = false;
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    @Column(name = "read_at")
    private LocalDateTime readAt;
}
