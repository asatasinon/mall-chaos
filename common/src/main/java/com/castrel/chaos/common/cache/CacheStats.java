package com.castrel.chaos.common.cache;

public record CacheStats(
        int entryCount,
        long holdingMb
) {}
