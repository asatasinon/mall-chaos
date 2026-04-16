package com.castrel.chaos.promotion.dto;

import lombok.Data;

import java.util.List;

@Data
public class PromotionRequest {
    private Long userId;
    private Long orderId; // required for calculate, optional for preview
    private List<SkuItem> skus;
}
