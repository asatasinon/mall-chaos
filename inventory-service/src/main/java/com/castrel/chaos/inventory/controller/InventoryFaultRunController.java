package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.inventory.service.InventoryLockExerciseService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/internal/inventory")
public class InventoryFaultRunController {
    private final InventoryLockExerciseService exerciseService;

    public InventoryFaultRunController(InventoryLockExerciseService exerciseService) {
        this.exerciseService = exerciseService;
    }

    @PostMapping("/fault-runs/start")
    public ApiResponse<Map<String, Object>> start(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        exerciseService.start(context);
        return ApiResponse.ok(Map.of("accepted", true, "operation", operation));
    }

    @PostMapping("/fault-runs/stop")
    public ApiResponse<Map<String, Object>> stop(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        exerciseService.stop(context);
        return ApiResponse.ok(Map.of("released", true, "faultRunId", context.runId()));
    }

    @PostMapping("/fault-runs/cleanup")
    public ApiResponse<Map<String, Object>> cleanup(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        if (!"INVENTORY_TABLE_EXCLUSIVE".equals(scenario)) throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported inventory scenario");
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        return ApiResponse.ok(exerciseService.release(context));
    }

    @PostMapping("/availability")
    public ApiResponse<Map<String, Object>> availability(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        return ApiResponse.ok(exerciseService.report(ScenarioRunContext.fromHeaders(headers)));
    }

    private void requireOperation(String scenario, String operation) {
        if (!"INVENTORY_TABLE_EXCLUSIVE".equals(scenario)
                || !"inventory-availability-report".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported inventory scenario operation");
        }
    }
}
