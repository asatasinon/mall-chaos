package com.castrel.chaos.order.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "orders")
@Data
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "order_no")
    private String orderNo;

    @Column(name = "user_id")
    private Long userId;

    private BigDecimal amount;

    private String status; // PENDING / PAID / FAILED / CANCELLED / COMPLETED

    @Version
    private Integer version;

    @Column(name = "idempotency_key")
    private String idempotencyKey;

    private BigDecimal subtotal;

    @Column(name = "discount_amount")
    private BigDecimal discountAmount;

    @Column(name = "total_amount")
    private BigDecimal totalAmount;

    @Column(name = "address_id")
    private Long addressId;

    @Column(name = "coupon_id")
    private Long couponId;

    @Column(name = "payment_id")
    private String paymentId;

    @Column(name = "fail_reason")
    private String failReason;

    @Column(name = "trace_id")
    private String traceId;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
