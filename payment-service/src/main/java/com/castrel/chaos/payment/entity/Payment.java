package com.castrel.chaos.payment.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "payment_attempts")
@Data
public class Payment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "payment_no")
    private String paymentNo;

    @Column(name = "order_id", nullable = false)
    private Long orderId;

    @Column(name = "customer_id", nullable = false)
    private Long customerId;

    private BigDecimal amount;

    private String status; // CREATED / PROCESSING / SUCCESS / FAILED / UNKNOWN

    @Column(name = "result_code")
    private String resultCode;

    @Column(name = "idempotency_key", nullable = false)
    private String idempotencyKey;

    @Column(name = "trace_id")
    private String traceId;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
