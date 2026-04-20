package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.maintenance.DataAuditRequest;
import com.castrel.chaos.common.maintenance.DataAuditService;
import com.castrel.chaos.common.maintenance.DataAuditStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/maintenance")
public class MaintenanceController {

    private final DataAuditService dataAuditService;

    public MaintenanceController(DataAuditService dataAuditService) {
        this.dataAuditService = dataAuditService;
    }

    @PostMapping("/data-audit/start")
    public ApiResponse<DataAuditStatus> startAudit(@RequestBody DataAuditRequest request) {
        dataAuditService.startAudit(request.tableName(), request.estimatedDurationSec());
        return ApiResponse.ok(dataAuditService.getStatus());
    }

    @PostMapping("/data-audit/stop")
    public ApiResponse<DataAuditStatus> stopAudit() {
        dataAuditService.stopAudit();
        return ApiResponse.ok(dataAuditService.getStatus());
    }

    @GetMapping("/data-audit/status")
    public ApiResponse<DataAuditStatus> auditStatus() {
        return ApiResponse.ok(dataAuditService.getStatus());
    }
}
