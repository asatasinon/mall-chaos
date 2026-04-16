package com.castrel.chaos.payment.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "payments")
@Data
public class Payment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "payment_no")
    private String paymentNo;

    @Column(name = "order_no")
    private String orderNo;

    @Column(name = "user_id")
    private Long userId;

    private BigDecimal amount;

    private String status; // PROCESSING / SUCCESS / FAILED / TIMEOUT

    @Column(name = "result_code")
    private String resultCode;

    @Column(name = "fail_reason")
    private String failReason;

    @Column(name = "trace_id")
    private String traceId;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
