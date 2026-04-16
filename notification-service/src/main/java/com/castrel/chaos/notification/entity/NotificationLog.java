package com.castrel.chaos.notification.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

@Entity
@Table(name = "notification_logs")
@Data
public class NotificationLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "event_type", length = 32, nullable = false)
    private String eventType; // ORDER_CREATED / PAYMENT_SUCCESS / PAYMENT_FAILED / SHIPPING

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "order_no", length = 32)
    private String orderNo;

    @Column(length = 16, nullable = false)
    private String channel = "MOCK"; // MOCK / SMS / EMAIL / PUSH

    @Column(length = 16, nullable = false)
    private String status = "SENT"; // SENT / FAILED

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "json")
    private Map<String, Object> payload;

    @Column(name = "trace_id", length = 64)
    private String traceId;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = LocalDateTime.now();
    }
}
