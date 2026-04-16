package com.castrel.chaos.order.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class OrderDTO {
    private Long id;
    private String orderNo;
    private Long userId;
    private String sku;
    private Integer qty;
    private BigDecimal amount;
    private String status;
    private String paymentId;
    private String failReason;
}
