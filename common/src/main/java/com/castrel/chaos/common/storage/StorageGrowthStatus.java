package com.castrel.chaos.common.storage;

import java.time.Instant;

public record StorageGrowthStatus(
        String runId,
        String status,
        long targetBytes,
        long writtenBytes,
        long writtenRows,
        long rateBytesPerSec,
        Instant startedAt,
        Instant stoppedAt,
        Instant autoStopAt,
        String stopReason,
        long freeSpaceBytes,
        String target,
        String targetService,
        String sourceService
) {
}
