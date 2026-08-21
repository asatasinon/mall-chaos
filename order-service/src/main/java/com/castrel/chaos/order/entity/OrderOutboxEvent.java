package com.castrel.chaos.order.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "order_outbox_events")
public class OrderOutboxEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String eventId;
    private String eventType;
    private String aggregateId;
    private Integer aggregateVersion;
    @Column(columnDefinition = "json")
    private String payload;
    private LocalDateTime occurredAt;
    private Integer schemaVersion;
    private String traceparent;
    private String traceId;
    private String trafficRunId;
    private String status;
    private Integer attempts;
    private LocalDateTime nextAttemptAt;
    private LocalDateTime publishedAt;
    private LocalDateTime createdAt;
}