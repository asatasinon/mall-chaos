package com.castrel.chaos.cart.controller;

import com.castrel.chaos.cart.service.CartService;
import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/internal/cart/fault-runs")
public class CartFaultRunController {
    private final CartService cartService;
    private final ScenarioRunGuard runGuard;
    private final StringRedisTemplate redisTemplate;

    public CartFaultRunController(CartService cartService, ScenarioRunGuard runGuard,
                                  StringRedisTemplate redisTemplate) {
        this.cartService = cartService;
        this.runGuard = runGuard;
        this.redisTemplate = redisTemplate;
    }

    @PostMapping("/start")
    public ApiResponse<Map<String, Object>> start(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody Map<String, Object> parameters) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validate(java.time.Instant.now());
        if (!runGuard.acceptStart(context)) throw new BizException("STALE_SCENARIO_RUN", "Scenario token was rejected");
        int fieldCount = integer(parameters, "fieldCount", 8, 1, 64);
        int fieldSize = integer(parameters, "fieldSizeBytes", 1024, 1, 65536);
        int totalSize = integer(parameters, "totalSizeBytes", 8192, 1, 1048576);
        int ttl = integer(parameters, "keyTtlSec", 600, 1, 3600);
        if ((long) fieldCount * fieldSize > totalSize) {
            throw new BizException("INVALID_EXERCISE_VALUE", "Field sizes exceed total size");
        }
        String key = cartService.exerciseKey(context.runId());
        String value = "x".repeat(fieldSize);
        Map<String, String> fields = new LinkedHashMap<>();
        for (int index = 0; index < fieldCount; index++) fields.put("field-" + index, value);
        redisTemplate.opsForHash().putAll(key, fields);
        redisTemplate.expire(key, java.time.Duration.ofSeconds(Math.min(ttl, context.expiresAt().getEpochSecond() - java.time.Instant.now().getEpochSecond())));
        runGuard.registerCleanup(context, () -> redisTemplate.delete(key));
        return ApiResponse.ok(Map.of("accepted", true, "faultRunId", context.runId(), "key", key,
                "bytes", fields.entrySet().stream().mapToLong(entry ->
                        entry.getKey().getBytes(StandardCharsets.UTF_8).length + entry.getValue().getBytes(StandardCharsets.UTF_8).length).sum()));
    }

    @PostMapping("/stop")
    public ApiResponse<Map<String, Object>> stop(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader("X-Fault-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        requireOperation(scenario, operation);
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        context.validateForRelease();
        runGuard.release(context);
        return ApiResponse.ok(Map.of("released", true, "faultRunId", context.runId()));
    }

    @PostMapping("/cleanup")
    public ApiResponse<Map<String, Object>> cleanup(
            @RequestHeader("X-Fault-Run-Scenario") String scenario,
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        if (!"CART_REDIS_LARGE_VALUE".equals(scenario)) throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported cart scenario");
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        return ApiResponse.ok(cartService.cleanExerciseRun(context));
    }

    @PostMapping("/cleanup-scenario")
    public ApiResponse<Map<String, Object>> cleanupScenario(@RequestBody Map<String, Object> body) {
        if (body == null || !"CART_REDIS_LARGE_VALUE".equals(body.get("scenario")) || body.size() != 1) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported cart scenario cleanup");
        }
        return ApiResponse.ok(cartService.cleanExerciseScenario());
    }

    private void requireOperation(String scenario, String operation) {
        if (!"CART_REDIS_LARGE_VALUE".equals(scenario) || !"cart-large-value".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported cart scenario operation");
        }
    }

    private int integer(Map<String, Object> parameters, String name, int defaultValue, int min, int max) {
        Object value = parameters == null ? null : parameters.get(name);
        int result = value == null ? defaultValue : value instanceof Number number ? number.intValue() : -1;
        if (result < min || result > max) throw new BizException("INVALID_EXERCISE_VALUE", name + " is out of range");
        return result;
    }
}