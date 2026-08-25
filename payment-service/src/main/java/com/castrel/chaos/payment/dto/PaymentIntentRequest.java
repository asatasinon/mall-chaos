package com.castrel.chaos.payment.dto;

import lombok.Data;

@Data
public class PaymentIntentRequest {
    private Long orderId;
    private Long userId;
    private String idempotencyKey;
}
