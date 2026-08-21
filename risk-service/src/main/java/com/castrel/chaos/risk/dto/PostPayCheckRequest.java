package com.castrel.chaos.risk.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class PostPayCheckRequest {
    private Long orderId;
    private Long userId;
    private String orderNo;
    private String paymentId;
    private BigDecimal amount;
}
