package com.castrel.chaos.inventory.dto;

public record DemoInventoryReplenishmentResult(
        String windowId,
        String correlationId,
        int skuCount,
        int addedQuantity,
        int skippedCount,
        int failedCount
) {
}
