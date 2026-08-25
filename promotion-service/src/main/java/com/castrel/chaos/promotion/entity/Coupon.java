package com.castrel.chaos.promotion.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Table(name = "coupons")
@Data
public class Coupon {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "promotion_id", nullable = false)
    private Long promotionId;

    @Column(nullable = false)
    private Integer status = 0; // 0=AVAILABLE, 1=RESERVED, 2=USED

    @Column(name = "expire_at")
    private LocalDateTime expireAt;

    @Column(name = "used_at")
    private LocalDateTime usedAt;
}
