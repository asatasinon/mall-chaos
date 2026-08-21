package com.castrel.chaos.fulfillment.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "shipment_timeline_events")
public class ShipmentTimelineEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "shipment_id", nullable = false)
    private Long shipmentId;
    @Column(nullable = false)
    private String status;
    @Column(nullable = false)
    private String message;
    @Column(name = "occurred_at")
    private LocalDateTime occurredAt;
}
