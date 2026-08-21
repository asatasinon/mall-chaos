package com.castrel.chaos.payment.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class PaymentIntentRequest {
    private String orderNo;
    private Long userId;
    private BigDecimal amount;
    private String idempotencyKey;
}
