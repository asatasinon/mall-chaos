package com.castrel.chaos.promotion.dto;

import lombok.Data;

import java.math.BigDecimal;
import java.util.List;

@Data
public class PromotionResultDTO {
    private BigDecimal originalAmount;
    private BigDecimal discountAmount;
    private BigDecimal finalAmount;
    private List<AppliedPromotion> appliedPromotions;
    private Long usedCouponId;

    @Data
    public static class AppliedPromotion {
        private Long promotionId;
        private String promotionName;
        private String type;
        private BigDecimal saving;
    }
}
