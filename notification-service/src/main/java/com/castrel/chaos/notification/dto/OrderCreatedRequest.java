package com.castrel.chaos.notification.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class OrderCreatedRequest {
    private String eventId;
    private Long userId;
    private String orderNo;
    private BigDecimal amount;
    private String sku;
}
