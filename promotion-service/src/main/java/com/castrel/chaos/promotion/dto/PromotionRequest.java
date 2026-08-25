package com.castrel.chaos.promotion.dto;

import lombok.Data;

import java.util.List;

@Data
public class PromotionRequest {
    private Long userId;
    private String orderId; // business correlation ID; required for calculate
    private Long couponId;
    private List<SkuItem> skus;
}
