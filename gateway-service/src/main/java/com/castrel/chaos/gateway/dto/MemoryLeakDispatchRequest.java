package com.castrel.chaos.gateway.dto;

import java.util.List;

public record MemoryLeakDispatchRequest(
        List<String> targets,
        int chunkSizeKb,
        int intervalMs,
        int maxMb,
        int durationSec) {}
