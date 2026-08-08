package com.castrel.chaos.gateway.dto;

public record StorageGrowthDispatchRequest(
        String targetService,
        String storageType,
        String runId,
        long targetBytes,
        long rateBytesPerSec,
        int durationSec,
        long minFreeBytes,
        Integer minFreePercent
) {
}
