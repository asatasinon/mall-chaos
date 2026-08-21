package com.castrel.chaos.fulfillment.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "fulfillment_outbox_events")
public class FulfillmentOutboxEvent {
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
    private LocalDateTime createdAt;
}
