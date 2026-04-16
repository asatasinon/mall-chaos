package com.castrel.chaos.risk.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class PostPayCheckRequest {
    private Long userId;
    private String orderNo;
    private String paymentId;
    private BigDecimal amount;
}
