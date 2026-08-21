package com.castrel.chaos.order.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class CheckoutItem {
    private Long id;
    private String sku;
    private Integer quantity;
    private String productName;
    private BigDecimal unitPrice;
}
