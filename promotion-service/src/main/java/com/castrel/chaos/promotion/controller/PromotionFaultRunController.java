package com.castrel.chaos.promotion.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.promotion.service.PromotionLockExerciseService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/internal/promotion")
public class PromotionFaultRunController {
    private final PromotionLockExerciseService exerciseService;

    public PromotionFaultRunController(PromotionLockExerciseService exerciseService) {
        this.exerciseService = exerciseService;
    }

    @PostMapping("/fault-runs/start")
    public ApiResponse<Map<String, Object>> start(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        exerciseService.start(ScenarioRunContext.fromHeaders(headers));
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
        if (!"PROMOTION_LOCK_CONTENTION".equals(scenario)) throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported promotion scenario");
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        exerciseService.cleanup(context);
        return ApiResponse.ok(Map.of("cleaned", true));
    }

    @PostMapping("/consistency")
    public ApiResponse<Map<String, Object>> consistency(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        return ApiResponse.ok(exerciseService.check(ScenarioRunContext.fromHeaders(headers)));
    }

    private void requireOperation(String scenario, String operation) {
        if (!"PROMOTION_LOCK_CONTENTION".equals(scenario)
                || !"coupon-reservation-consistency".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported promotion scenario operation");
        }
    }
}
