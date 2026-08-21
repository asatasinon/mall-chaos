package com.castrel.chaos.order.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "order_inbox_events")
public class OrderInboxEvent {
    @Id
    private String eventId;
    private String eventType;
    private LocalDateTime receivedAt;
    private LocalDateTime processedAt;
    private String status;
    private String failureReason;
}