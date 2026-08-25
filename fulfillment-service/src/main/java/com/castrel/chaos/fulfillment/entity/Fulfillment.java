package com.castrel.chaos.fulfillment.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Table(name = "shipments")
@Data
public class Fulfillment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "order_id", nullable = false, unique = true)
    private Long orderId;

    @Column(name = "customer_id", nullable = false)
    private Long customerId;

    @Column(name = "order_no", nullable = false, length = 32)
    private String orderNo;

    @Column(length = 16, nullable = false)
    private String status = "CREATED"; // CREATED / PICKING / SHIPPED / DELIVERED / CANCELLED

    @Column(name = "tracking_no", length = 64)
    private String trackingNo;

    @Column(length = 32)
    private String carrier = "MockExpress";

    @Transient
    private LocalDateTime shippedAt;

    @Transient
    private LocalDateTime deliveredAt;

    @Transient
    private String cancelReason;

    @Transient
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
