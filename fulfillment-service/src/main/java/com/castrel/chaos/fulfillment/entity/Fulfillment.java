package com.castrel.chaos.fulfillment.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Table(name = "fulfillments")
@Data
public class Fulfillment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "order_id", nullable = false, unique = true)
    private Long orderId;

    @Column(name = "order_no", length = 32, nullable = false)
    private String orderNo;

    @Column(length = 16, nullable = false)
    private String status = "CREATED"; // CREATED / PICKING / SHIPPED / DELIVERED / CANCELLED

    @Column(name = "tracking_no", length = 64)
    private String trackingNo;

    @Column(length = 32)
    private String carrier = "MockExpress";

    @Column(name = "shipped_at")
    private LocalDateTime shippedAt;

    @Column(name = "delivered_at")
    private LocalDateTime deliveredAt;

    @Column(name = "cancel_reason", length = 256)
    private String cancelReason;

    @Column(name = "trace_id", length = 64)
    private String traceId;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    void prePersist() {
        LocalDateTime now = LocalDateTime.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
