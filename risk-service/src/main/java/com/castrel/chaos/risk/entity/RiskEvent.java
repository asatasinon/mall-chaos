package com.castrel.chaos.risk.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Table(name = "risk_events")
@Data
public class RiskEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "order_no", length = 32)
    private String orderNo;

    @Column(name = "event_type", length = 32, nullable = false)
    private String eventType; // PRE_CHECK_PASS / PRE_CHECK_REJECT / POST_PAY_FREEZE

    @Column(length = 256)
    private String reason;

    @Column(name = "trace_id", length = 64)
    private String traceId;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = LocalDateTime.now();
    }
}
