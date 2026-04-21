package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.gateway.dto.*;
import com.castrel.chaos.gateway.service.ChaosDispatchService;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/internal/gateway/chaos")
public class ChaosDispatchController {

    private final ChaosDispatchService dispatchService;

    public ChaosDispatchController(ChaosDispatchService dispatchService) {
        this.dispatchService = dispatchService;
    }

    // ── Slow SQL ─────────────────────────────────────────────────────────

    @PostMapping("/slow-sql/enable")
    public Mono<ApiResponse<Map<String, Object>>> enableSlowSql(
            @RequestBody SlowSqlDispatchRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        Map<String, Object> body = Map.of(
                "mode", req.mode(),
                "delayMs", req.delayMs(),
                "injectRate", req.injectRate(),
                "scope", req.scope(),
                "durationSec", req.durationSec()
        );
        return dispatchService.dispatchPost("slow-sql", req.targets(), "/internal/chaos/slow-sql/enable", body, traceId)
                .map(ApiResponse::ok);
    }

    @PostMapping("/slow-sql/disable")
    public Mono<ApiResponse<Map<String, Object>>> disableSlowSql(
            @RequestBody TargetServicesRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchPost("slow-sql", req.targets(), "/internal/chaos/slow-sql/disable", Map.of(), traceId)
                .map(ApiResponse::ok);
    }

    @GetMapping("/slow-sql/status")
    public Mono<ApiResponse<Map<String, Object>>> slowSqlStatus(
            @RequestParam(required = false) List<String> targets,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchGet("slow-sql", targets, "/internal/chaos/slow-sql/status", traceId)
                .map(ApiResponse::ok);
    }

    // ── Memory Leak ──────────────────────────────────────────────────────

    @PostMapping("/memory-leak/enable")
    public Mono<ApiResponse<Map<String, Object>>> enableMemoryLeak(
            @RequestBody MemoryLeakDispatchRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        Map<String, Object> body = Map.of(
                "chunkSizeKb", req.chunkSizeKb(),
                "intervalMs", req.intervalMs(),
                "maxMb", req.maxMb(),
                "durationSec", req.durationSec()
        );
        return dispatchService.dispatchPost("memory-leak", req.targets(), "/internal/chaos/memory-leak/enable", body, traceId)
                .map(ApiResponse::ok);
    }

    @PostMapping("/memory-leak/disable")
    public Mono<ApiResponse<Map<String, Object>>> disableMemoryLeak(
            @RequestBody TargetServicesRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchPost("memory-leak", req.targets(), "/internal/chaos/memory-leak/disable", Map.of(), traceId)
                .map(ApiResponse::ok);
    }

    @PostMapping("/memory-leak/cleanup")
    public Mono<ApiResponse<Map<String, Object>>> cleanupMemoryLeak(
            @RequestBody TargetServicesRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchPost("memory-leak", req.targets(), "/internal/chaos/memory-leak/cleanup", Map.of(), traceId)
                .map(ApiResponse::ok);
    }

    @GetMapping("/memory-leak/status")
    public Mono<ApiResponse<Map<String, Object>>> memoryLeakStatus(
            @RequestParam(required = false) List<String> targets,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchGet("memory-leak", targets, "/internal/chaos/memory-leak/status", traceId)
                .map(ApiResponse::ok);
    }

    // ── Deadlock ─────────────────────────────────────────────────────────

    @PostMapping("/deadlock/enable")
    public Mono<ApiResponse<Map<String, Object>>> enableDeadlock(
            @RequestBody DeadlockDispatchRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        Map<String, Object> body = Map.of(
                "injectRate", req.injectRate(),
                "scope", req.scope(),
                "durationSec", req.durationSec()
        );
        return dispatchService.dispatchPost("deadlock", req.targets(), "/internal/chaos/deadlock/enable", body, traceId)
                .map(ApiResponse::ok);
    }

    @PostMapping("/deadlock/disable")
    public Mono<ApiResponse<Map<String, Object>>> disableDeadlock(
            @RequestBody TargetServicesRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchPost("deadlock", req.targets(), "/internal/chaos/deadlock/disable", Map.of(), traceId)
                .map(ApiResponse::ok);
    }

    @PostMapping("/deadlock/cleanup")
    public Mono<ApiResponse<Map<String, Object>>> cleanupDeadlock(
            @RequestBody TargetServicesRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchPost("deadlock", req.targets(), "/internal/chaos/deadlock/cleanup", Map.of(), traceId)
                .map(ApiResponse::ok);
    }

    @GetMapping("/deadlock/status")
    public Mono<ApiResponse<Map<String, Object>>> deadlockStatus(
            @RequestParam(required = false) List<String> targets,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchGet("deadlock", targets, "/internal/chaos/deadlock/status", traceId)
                .map(ApiResponse::ok);
    }

    // ── Table Lock ───────────────────────────────────────────────────────

    @PostMapping("/table-lock/enable")
    public Mono<ApiResponse<Map<String, Object>>> enableTableLock(
            @RequestBody TableLockDispatchRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        Map<String, Object> body = Map.of(
                "targetTable", req.targetTable(),
                "durationSec", req.durationSec()
        );
        return dispatchService.dispatchPost("table-lock", List.of(req.targetService()),
                        "/internal/chaos/table-lock/enable", body, traceId)
                .map(ApiResponse::ok);
    }

    @PostMapping("/table-lock/disable")
    public Mono<ApiResponse<Map<String, Object>>> disableTableLock(
            @RequestBody TableLockDispatchRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchPost("table-lock", List.of(req.targetService()),
                        "/internal/chaos/table-lock/disable", Map.of("targetTable", req.targetTable()), traceId)
                .map(ApiResponse::ok);
    }

    @GetMapping("/table-lock/status")
    public Mono<ApiResponse<Map<String, Object>>> tableLockStatus(
            @RequestParam String targetService,
            @RequestParam String targetTable,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.dispatchGet("table-lock", List.of(targetService),
                        "/internal/chaos/table-lock/status?targetTable=" + targetTable, traceId)
                .map(ApiResponse::ok);
    }
}
