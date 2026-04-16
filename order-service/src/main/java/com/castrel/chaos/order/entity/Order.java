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

    private String sku;

    private Integer qty;

    private BigDecimal amount;

    private String status; // PENDING / PAID / FAILED / CANCELLED / COMPLETED

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
