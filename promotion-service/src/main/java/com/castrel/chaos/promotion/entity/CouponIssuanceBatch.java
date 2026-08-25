package com.castrel.chaos.promotion.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "coupon_issuance_batches", uniqueConstraints = @UniqueConstraint(
        name = "uq_coupon_issuance_batch", columnNames = {"window_id", "customer_id", "promotion_id"}))
public class CouponIssuanceBatch {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "window_id", nullable = false, length = 64)
    private String windowId;

    @Column(name = "customer_id", nullable = false)
    private Long customerId;

    @Column(name = "promotion_id", nullable = false)
    private Long promotionId;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
