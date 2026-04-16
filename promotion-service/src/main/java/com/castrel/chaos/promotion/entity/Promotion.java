package com.castrel.chaos.promotion.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "promotions")
@Data
public class Promotion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 32, nullable = false)
    private String type; // DISCOUNT / FULL_REDUCTION / COUPON

    @Column(length = 128, nullable = false)
    private String name;

    @Column(name = "min_amount", nullable = false, precision = 10, scale = 2)
    private BigDecimal minAmount = BigDecimal.ZERO;

    @Column(precision = 4, scale = 2)
    private BigDecimal discount; // e.g. 0.80 = 80% of original

    @Column(name = "reduce_amt", precision = 10, scale = 2)
    private BigDecimal reduceAmt;

    @Column(nullable = false)
    private Integer enabled = 1;

    @Column(name = "start_at")
    private LocalDateTime startAt;

    @Column(name = "end_at")
    private LocalDateTime endAt;

    @Column(name = "created_at")
    private LocalDateTime createdAt;
}
