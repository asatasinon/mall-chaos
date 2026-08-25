package com.castrel.chaos.promotion.dto;

public record DemoCouponReplenishmentResult(
        String windowId,
        String correlationId,
        int customerCount,
        int promotionCount,
        int addedCount,
        int skippedCount,
        int failedCount
) {
}
