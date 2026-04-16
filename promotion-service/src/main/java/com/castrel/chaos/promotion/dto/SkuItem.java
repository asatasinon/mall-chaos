package com.castrel.chaos.promotion.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class SkuItem {
    private String sku;
    private int qty;
    private BigDecimal price;
}
