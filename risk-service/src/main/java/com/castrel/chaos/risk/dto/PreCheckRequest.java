package com.castrel.chaos.risk.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class PreCheckRequest {
    private Long userId;
    private String orderNo;
    private BigDecimal amount;
    private String sku;
    private int qty;
}
