package com.castrel.chaos.common.storage;

public record StorageGrowthRequest(
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
