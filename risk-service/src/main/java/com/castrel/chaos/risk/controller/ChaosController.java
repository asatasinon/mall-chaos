package com.castrel.chaos.risk.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.chaos.SlowSqlChaosService;
import com.castrel.chaos.risk.dto.SlowSqlEnableRequest;
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
    public ApiResponse<Map<String, Object>> enable(@RequestBody SlowSqlEnableRequest req) {
        slowSqlChaosService.enable(req.getMode(), req.getDelayMs(), req.getInjectRate(), req.getDurationSec());
        return ApiResponse.ok(Map.of(
                "enabled", true,
                "mode", req.getMode(),
                "delayMs", req.getDelayMs(),
                "autoDisableAt", slowSqlChaosService.getAutoDisableAt() != null
                        ? slowSqlChaosService.getAutoDisableAt().toString() : "N/A"
        ));
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
