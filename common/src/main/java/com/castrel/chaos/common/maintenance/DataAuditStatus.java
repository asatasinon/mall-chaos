package com.castrel.chaos.common.maintenance;

public record DataAuditStatus(
        boolean active,
        String tableName,
        String status,
        String startedAt,
        String holdingDuration
) {}
