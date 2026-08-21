package com.castrel.chaos.risk.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "risk_outbox_events")
public class RiskOutboxEvent {
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
    private String traceId;
    private String status;
    private Integer attempts;
    @Column(name = "next_attempt_at")
    private LocalDateTime nextAttemptAt;
    @Column(name = "published_at")
    private LocalDateTime publishedAt;
    private LocalDateTime createdAt;
}