package com.castrel.chaos.risk.dto;

import lombok.Data;

import java.math.BigDecimal;
import java.util.List;

@Data
public class PreCheckRequest {
    private Long userId;
    private String orderNo;
    private BigDecimal amount;
    private List<Item> items;

    @Data
    public static class Item {
        private String sku;
        private int quantity;
    }
}
