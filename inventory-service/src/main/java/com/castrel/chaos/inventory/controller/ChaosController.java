package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.chaos.SlowSqlChaosService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@Profile("chaos")
public class ChaosController {

    @Autowired
    private SlowSqlChaosService slowSqlChaosService;

    @PostMapping("/internal/chaos/slow-sql/enable")
    public ApiResponse<Map<String, Object>> enable(@RequestBody Map<String, Object> req) {
        String mode = (String) req.getOrDefault("mode", "sleep");
        long delayMs = ((Number) req.getOrDefault("delayMs", 1000)).longValue();
        double injectRate = ((Number) req.getOrDefault("injectRate", 1.0)).doubleValue();
        int durationSec = ((Number) req.getOrDefault("durationSec", 0)).intValue();
        slowSqlChaosService.enable(mode, delayMs, injectRate, durationSec);
        return ApiResponse.ok(Map.of("enabled", true, "mode", mode, "delayMs", delayMs));
    }

    @PostMapping("/internal/chaos/slow-sql/disable")
    public ApiResponse<Void> disable() {
        slowSqlChaosService.disable();
        return ApiResponse.ok();
    }

    @GetMapping("/internal/chaos/slow-sql/status")
    public ApiResponse<Map<String, Object>> status() {
        return ApiResponse.ok(Map.of(
                "enabled", slowSqlChaosService.isEnabled(),
                "mode", slowSqlChaosService.getMode(),
                "delayMs", slowSqlChaosService.getDelayMs(),
                "injectRate", slowSqlChaosService.getInjectRate(),
                "autoDisableAt", slowSqlChaosService.getAutoDisableAt() != null
                        ? slowSqlChaosService.getAutoDisableAt().toString() : "N/A"
        ));
    }
}
