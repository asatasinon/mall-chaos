package com.castrel.chaos.payment.dto;

import lombok.Data;

@Data
public class RefundRequest {
    private String idempotencyKey;
    private String correlationId;
}
