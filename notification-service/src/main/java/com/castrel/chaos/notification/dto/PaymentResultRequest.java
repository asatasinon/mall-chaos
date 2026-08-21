package com.castrel.chaos.notification.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class PaymentResultRequest {
    private String eventId;
    private Long userId;
    private String orderNo;
    private boolean success;
    private BigDecimal amount;
    private BigDecimal totalAmount;
}
