package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.common.maintenance.DataAuditRequest;
import com.castrel.chaos.common.maintenance.DataAuditService;
import com.castrel.chaos.common.maintenance.DataAuditStatus;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/internal/maintenance")
public class MaintenanceController {

    private final DataAuditService dataAuditService;
    private final QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    public MaintenanceController(DataAuditService dataAuditService,
                                  QueryEnrichmentInterceptor queryEnrichmentInterceptor) {
        this.dataAuditService = dataAuditService;
        this.queryEnrichmentInterceptor = queryEnrichmentInterceptor;
    }

    /**
     * Forces the query-enrichment local cache to expire so the next
     * {@code GET /api/orders/{id}} call is guaranteed to issue a fresh
     * {@code HGETALL castrel:query:enrichment} against Redis. Used by the
     * BigKey chaos scenario to eliminate the 5s cache window as a source of
     * flakiness when reproducing slow reads.
     */
    @PostMapping("/query-enrichment/force-refresh")
    public ApiResponse<Map<String, String>> forceRefreshQueryEnrichment() {
        queryEnrichmentInterceptor.forceRefreshOnNextCheck();
        return ApiResponse.ok(Map.of("status", "next request will bypass local cache"));
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
