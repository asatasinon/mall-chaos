package com.castrel.chaos.common.chaos;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.maintenance.DataAuditService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Unified chaos REST controller providing standardised endpoints for all chaos types.
 * Auto-registered in every service via ServiceComponentAutoConfiguration.
 *
 * Endpoints:
 *   /internal/chaos/slow-sql/{enable,disable,status}
 *   /internal/chaos/memory-leak/{enable,disable,cleanup,status}
 *   /internal/chaos/deadlock/{enable,disable,cleanup,status}
 *   /internal/chaos/table-lock/{enable,disable,status}
 */
@RestController
@RequestMapping("/internal/chaos")
@ConditionalOnBean(ChaosService.class)
public class ChaosController {

    private final ChaosService chaosService;
    private final DataAuditService dataAuditService;

    public ChaosController(ChaosService chaosService, DataAuditService dataAuditService) {
        this.chaosService = chaosService;
        this.dataAuditService = dataAuditService;
    }

    // ── Slow SQL ─────────────────────────────────────────────────────────

    @PostMapping("/slow-sql/enable")
    public ApiResponse<Map<String, Object>> enableSlowSql(@RequestBody Map<String, Object> req) {
        String mode = (String) req.getOrDefault("mode", "real");
        int delayMs = ((Number) req.getOrDefault("delayMs", 3000)).intValue();
        double injectRate = ((Number) req.getOrDefault("injectRate", 1.0)).doubleValue();
        String scope = (String) req.getOrDefault("scope", "ALL");
        int durationSec = ((Number) req.getOrDefault("durationSec", 0)).intValue();

        chaosService.enableSlowSql(mode, delayMs, injectRate, scope, durationSec);
        return ApiResponse.ok(chaosService.getSlowSqlStatus());
    }

    @PostMapping("/slow-sql/disable")
    public ApiResponse<Map<String, Object>> disableSlowSql() {
        chaosService.disableSlowSql();
        return ApiResponse.ok(chaosService.getSlowSqlStatus());
    }

    @GetMapping("/slow-sql/status")
    public ApiResponse<Map<String, Object>> slowSqlStatus() {
        return ApiResponse.ok(chaosService.getSlowSqlStatus());
    }

    // ── Memory Leak ──────────────────────────────────────────────────────

    @PostMapping("/memory-leak/enable")
    public ApiResponse<Map<String, Object>> enableMemoryLeak(@RequestBody Map<String, Object> req) {
        int chunkSizeKb = ((Number) req.getOrDefault("chunkSizeKb", 512)).intValue();
        int intervalMs = ((Number) req.getOrDefault("intervalMs", 500)).intValue();
        int maxMb = ((Number) req.getOrDefault("maxMb", 256)).intValue();
        int durationSec = ((Number) req.getOrDefault("durationSec", 0)).intValue();

        chaosService.enableMemoryLeak(chunkSizeKb, intervalMs, maxMb, durationSec);
        return ApiResponse.ok(chaosService.getMemoryLeakStatus());
    }

    @PostMapping("/memory-leak/disable")
    public ApiResponse<Map<String, Object>> disableMemoryLeak() {
        chaosService.disableMemoryLeak();
        return ApiResponse.ok(chaosService.getMemoryLeakStatus());
    }

    @PostMapping("/memory-leak/cleanup")
    public ApiResponse<Map<String, Object>> cleanupMemoryLeak() {
        chaosService.cleanupMemoryLeak();
        return ApiResponse.ok(chaosService.getMemoryLeakStatus());
    }

    @GetMapping("/memory-leak/status")
    public ApiResponse<Map<String, Object>> memoryLeakStatus() {
        return ApiResponse.ok(chaosService.getMemoryLeakStatus());
    }

    // ── Deadlock ─────────────────────────────────────────────────────────

    @PostMapping("/deadlock/enable")
    public ApiResponse<Map<String, Object>> enableDeadlock(@RequestBody Map<String, Object> req) {
        double injectRate = ((Number) req.getOrDefault("injectRate", 0.5)).doubleValue();
        String scope = (String) req.getOrDefault("scope", "ALL");
        int durationSec = ((Number) req.getOrDefault("durationSec", 0)).intValue();

        chaosService.enableDeadlock(injectRate, scope, durationSec);
        return ApiResponse.ok(chaosService.getDeadlockStatus());
    }

    @PostMapping("/deadlock/disable")
    public ApiResponse<Map<String, Object>> disableDeadlock() {
        chaosService.disableDeadlock();
        return ApiResponse.ok(chaosService.getDeadlockStatus());
    }

    @PostMapping("/deadlock/cleanup")
    public ApiResponse<Map<String, Object>> cleanupDeadlock() {
        chaosService.cleanupDeadlock();
        return ApiResponse.ok(chaosService.getDeadlockStatus());
    }

    @GetMapping("/deadlock/status")
    public ApiResponse<Map<String, Object>> deadlockStatus() {
        return ApiResponse.ok(chaosService.getDeadlockStatus());
    }

    // ── Table Lock (delegates to existing DataAuditService) ──────────────

    @PostMapping("/table-lock/enable")
    public ApiResponse<Object> enableTableLock(@RequestBody Map<String, Object> req) {
        String targetTable = (String) req.get("targetTable");
        int durationSec = ((Number) req.getOrDefault("durationSec", 300)).intValue();

        dataAuditService.startAudit(targetTable, durationSec);
        return ApiResponse.ok(dataAuditService.getStatus());
    }

    @PostMapping("/table-lock/disable")
    public ApiResponse<Object> disableTableLock() {
        dataAuditService.stopAudit();
        return ApiResponse.ok(dataAuditService.getStatus());
    }

    @GetMapping("/table-lock/status")
    public ApiResponse<Object> tableLockStatus() {
        return ApiResponse.ok(dataAuditService.getStatus());
    }
}
