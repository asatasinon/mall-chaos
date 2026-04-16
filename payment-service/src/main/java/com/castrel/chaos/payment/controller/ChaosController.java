package com.castrel.chaos.payment.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.chaos.MemoryLeakChaosService;
import com.castrel.chaos.common.chaos.SlowSqlChaosService;
import com.castrel.chaos.payment.chaos.DeadlockChaosService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@Profile("chaos")
public class ChaosController {

    @Autowired
    private SlowSqlChaosService slowSqlChaosService;

    @Autowired
    private MemoryLeakChaosService memoryLeakChaosService;

    @Autowired
    private DeadlockChaosService deadlockChaosService;

    // ── Slow SQL ─────────────────────────────────────────────────────────────
    @PostMapping("/internal/chaos/slow-sql/enable")
    public ApiResponse<Map<String, Object>> slowSqlEnable(@RequestBody Map<String, Object> req) {
        String mode = (String) req.getOrDefault("mode", "sleep");
        long delayMs = ((Number) req.getOrDefault("delayMs", 1000)).longValue();
        double injectRate = ((Number) req.getOrDefault("injectRate", 1.0)).doubleValue();
        int durationSec = ((Number) req.getOrDefault("durationSec", 0)).intValue();
        slowSqlChaosService.enable(mode, delayMs, injectRate, durationSec);
        return ApiResponse.ok(Map.of("enabled", true, "mode", mode, "delayMs", delayMs,
                "autoDisableAt", slowSqlChaosService.getAutoDisableAt() != null
                        ? slowSqlChaosService.getAutoDisableAt().toString() : "N/A"));
    }

    @PostMapping("/internal/chaos/slow-sql/disable")
    public ApiResponse<Void> slowSqlDisable() {
        slowSqlChaosService.disable();
        return ApiResponse.ok();
    }

    @GetMapping("/internal/chaos/slow-sql/status")
    public ApiResponse<Map<String, Object>> slowSqlStatus() {
        return ApiResponse.ok(Map.of(
                "enabled", slowSqlChaosService.isEnabled(),
                "mode", slowSqlChaosService.getMode(),
                "delayMs", slowSqlChaosService.getDelayMs(),
                "injectRate", slowSqlChaosService.getInjectRate(),
                "autoDisableAt", slowSqlChaosService.getAutoDisableAt() != null
                        ? slowSqlChaosService.getAutoDisableAt().toString() : "N/A"
        ));
    }

    // ── Memory Leak ───────────────────────────────────────────────────────────
    @PostMapping("/internal/chaos/memory-leak/start")
    public ApiResponse<Map<String, Object>> memoryLeakStart(@RequestBody(required = false) Map<String, Object> req) {
        if (req == null) req = Map.of();
        int chunkSizeKb = ((Number) req.getOrDefault("chunkSizeKb", 1024)).intValue();
        long intervalMs = ((Number) req.getOrDefault("intervalMs", 500)).longValue();
        int maxMb = ((Number) req.getOrDefault("maxMb", 512)).intValue();
        memoryLeakChaosService.start(chunkSizeKb, intervalMs, maxMb);
        return ApiResponse.ok(Map.of("running", true, "chunkSizeKb", chunkSizeKb,
                "intervalMs", intervalMs, "maxMb", maxMb));
    }

    @PostMapping("/internal/chaos/memory-leak/stop")
    public ApiResponse<Void> memoryLeakStop() {
        memoryLeakChaosService.stop();
        return ApiResponse.ok();
    }

    @PostMapping("/internal/chaos/memory-leak/clear")
    public ApiResponse<Void> memoryLeakClear() {
        memoryLeakChaosService.clear();
        return ApiResponse.ok();
    }

    @GetMapping("/internal/chaos/memory-leak/status")
    public ApiResponse<Map<String, Object>> memoryLeakStatus() {
        return ApiResponse.ok(Map.of(
                "running", memoryLeakChaosService.isRunning(),
                "holdingMb", memoryLeakChaosService.getHoldingMb(),
                "objectCount", memoryLeakChaosService.getObjectCount(),
                "chunkSizeKb", memoryLeakChaosService.getChunkSizeKb(),
                "intervalMs", memoryLeakChaosService.getIntervalMs(),
                "maxMb", memoryLeakChaosService.getMaxMb()
        ));
    }

    // ── Deadlock ──────────────────────────────────────────────────────────────
    @PostMapping("/internal/chaos/deadlock/enable")
    public ApiResponse<Map<String, Object>> deadlockEnable(@RequestBody Map<String, Object> req) {
        double injectRate = ((Number) req.getOrDefault("injectRate", 0.3)).doubleValue();
        int durationSec = ((Number) req.getOrDefault("durationSec", 0)).intValue();
        deadlockChaosService.enable(injectRate, durationSec);
        return ApiResponse.ok(Map.of("enabled", true, "injectRate", injectRate));
    }

    @PostMapping("/internal/chaos/deadlock/disable")
    public ApiResponse<Void> deadlockDisable() {
        deadlockChaosService.disable();
        return ApiResponse.ok();
    }

    @PostMapping("/internal/chaos/deadlock/clear")
    public ApiResponse<Void> deadlockClear() {
        deadlockChaosService.clear();
        return ApiResponse.ok();
    }

    @GetMapping("/internal/chaos/deadlock/status")
    public ApiResponse<Map<String, Object>> deadlockStatus() {
        return ApiResponse.ok(Map.of(
                "enabled", deadlockChaosService.isEnabled(),
                "deadlockCount", deadlockChaosService.getDeadlockCount(),
                "lastError", deadlockChaosService.getLastError() != null ? deadlockChaosService.getLastError() : "",
                "autoDisableAt", deadlockChaosService.getAutoDisableAt() != null
                        ? deadlockChaosService.getAutoDisableAt().toString() : "N/A"
        ));
    }
}
