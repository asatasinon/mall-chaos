package com.castrel.chaos.runner.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.runner.service.TrafficRunnerService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
public class RunnerController {

    @Autowired
    private TrafficRunnerService runnerService;

    @GetMapping("/internal/runner/status")
    public ApiResponse<Map<String, Object>> status() {
        return ApiResponse.ok(runnerService.getStatus());
    }

    @PostMapping("/internal/runner/pause")
    public ApiResponse<Void> pause() {
        runnerService.pause();
        return ApiResponse.ok();
    }

    @PostMapping("/internal/runner/resume")
    public ApiResponse<Void> resume() {
        runnerService.resume();
        return ApiResponse.ok();
    }

    @PostMapping("/internal/runner/rate")
    public ApiResponse<Map<String, Object>> rate(@RequestBody Map<String, Object> req) {
        double multiplier = ((Number) req.getOrDefault("multiplier", 1.0)).doubleValue();
        runnerService.setRateMultiplier(multiplier);
        return ApiResponse.ok(Map.of("multiplier", multiplier));
    }

    @PostMapping("/internal/runner/inventory-reset/trigger")
    public ApiResponse<Void> triggerReset() {
        runnerService.triggerInventoryReset(true);
        return ApiResponse.ok();
    }

    @PutMapping("/internal/runner/config")
    public ApiResponse<Map<String, Object>> updateConfig(@RequestBody Map<String, Object> req) {
        return ApiResponse.ok(runnerService.updateConfig(req));
    }

    @GetMapping("/internal/runner/config")
    public ApiResponse<Map<String, Object>> getConfig() {
        return ApiResponse.ok(runnerService.getConfigStatus());
    }
}
