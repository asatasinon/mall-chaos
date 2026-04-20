package com.castrel.chaos.common.maintenance;

public record DataAuditRequest(
        String tableName,
        String auditType,
        int estimatedDurationSec
) {
    public DataAuditRequest {
        if (auditType == null) auditType = "FULL_CONSISTENCY";
        if (estimatedDurationSec <= 0) estimatedDurationSec = 300;
    }
}
