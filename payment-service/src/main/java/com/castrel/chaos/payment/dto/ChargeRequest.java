package com.castrel.chaos.payment.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class ChargeRequest {
    private String orderId;
    private String orderNo;
    private Long userId;
    private BigDecimal amount;
}
