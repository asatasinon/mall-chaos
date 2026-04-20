package com.castrel.chaos.runner.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.runner.model.MemoryPressureRequest;
import com.castrel.chaos.runner.model.SlowQueryRequest;
import com.castrel.chaos.runner.model.TableLockRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/internal/runner/scenario")
public class ScenarioController {

    private static final Logger log = LoggerFactory.getLogger(ScenarioController.class);

    private static final String REDIS_KEY_TABLE_LOCK = "castrel:maintenance:lock-audit";
    private static final String REDIS_KEY_SLOW_QUERY = "castrel:query:enrichment";
    private static final String REDIS_KEY_MEMORY = "castrel:cache:local-buffer";

    private final StringRedisTemplate redisTemplate;
    private final RestTemplate restTemplate;
    private final Map<String, String> serviceUrlMap;

    public ScenarioController(
            StringRedisTemplate redisTemplate,
            @Value("${services.order-url}") String orderUrl,
            @Value("${services.payment-url}") String paymentUrl,
            @Value("${services.inventory-url}") String inventoryUrl,
            @Value("${services.catalog-url}") String catalogUrl,
            @Value("${services.promotion-url}") String promotionUrl,
            @Value("${services.risk-url}") String riskUrl,
            @Value("${services.fulfillment-url}") String fulfillmentUrl,
            @Value("${services.notification-url}") String notificationUrl) {
        this.redisTemplate = redisTemplate;
        this.restTemplate = new RestTemplate();
        this.serviceUrlMap = Map.of(
                "order-service", orderUrl,
                "payment-service", paymentUrl,
                "inventory-service", inventoryUrl,
                "catalog-service", catalogUrl,
                "promotion-service", promotionUrl,
                "risk-service", riskUrl,
                "fulfillment-service", fulfillmentUrl,
                "notification-service", notificationUrl
        );
    }

    // ─── Table Lock ──────────────────────────────────────────────────────

    @PostMapping("/table-lock/enable")
    public ApiResponse<Map<String, Object>> enableTableLock(@RequestBody TableLockRequest req) {
        String baseUrl = serviceUrlMap.get(req.targetService());
        if (baseUrl == null) {
            return ApiResponse.error(400, "Unknown service: " + req.targetService());
        }

        // Write Redis state
        Map<String, String> hash = Map.of(
                "active", "true",
                "targetTable", req.targetTable(),
                "targetService", req.targetService(),
                "durationSec", String.valueOf(req.durationSec()),
                "startedAt", Instant.now().toString(),
                "operator", "scenario-controller"
        );
        redisTemplate.opsForHash().putAll(REDIS_KEY_TABLE_LOCK, hash);

        // Call target service to acquire table lock
        try {
            String url = baseUrl + "/internal/maintenance/data-audit/start";
            Map<String, Object> body = Map.of(
                    "tableName", req.targetTable(),
                    "auditType", "FULL_CONSISTENCY",
                    "estimatedDurationSec", req.durationSec()
            );
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            restTemplate.postForEntity(url, new HttpEntity<>(body, headers), Map.class);
        } catch (Exception e) {
            log.warn("Failed to call target service {} for table lock: {}", req.targetService(), e.getMessage());
            return ApiResponse.error(502,
                    "Table lock Redis state set, but target service call failed: " + e.getMessage());
        }

        return ApiResponse.ok(Map.of(
                "scenario", "table-lock",
                "status", "enabled",
                "targetService", req.targetService(),
                "targetTable", req.targetTable(),
                "durationSec", req.durationSec()
        ));
    }

    @PostMapping("/table-lock/disable")
    public ApiResponse<Map<String, Object>> disableTableLock() {
        // Read current state to find target service
        Object targetService = redisTemplate.opsForHash().get(REDIS_KEY_TABLE_LOCK, "targetService");
        redisTemplate.opsForHash().put(REDIS_KEY_TABLE_LOCK, "active", "false");

        if (targetService != null) {
            String baseUrl = serviceUrlMap.get(targetService.toString());
            if (baseUrl != null) {
                try {
                    restTemplate.postForEntity(
                            baseUrl + "/internal/maintenance/data-audit/stop",
                            null, Map.class);
                } catch (Exception e) {
                    log.warn("Failed to call stop on {}: {}", targetService, e.getMessage());
                }
            }
        }

        return ApiResponse.ok(Map.of("scenario", "table-lock", "status", "disabled"));
    }

    @GetMapping("/table-lock/status")
    public ApiResponse<Map<Object, Object>> tableLockStatus() {
        Map<Object, Object> hash = redisTemplate.opsForHash().entries(REDIS_KEY_TABLE_LOCK);
        return ApiResponse.ok(hash);
    }

    // ─── Slow Query ──────────────────────────────────────────────────────

    @PostMapping("/slow-query/enable")
    public ApiResponse<Map<String, Object>> enableSlowQuery(@RequestBody SlowQueryRequest req) {
        String targetServices = req.targetServices() != null
                ? String.join(",", req.targetServices()) : "";
        Map<String, String> hash = Map.of(
                "enabled", "true",
                "joinTable", req.joinTable(),
                "targetServices", targetServices,
                "operator", "scenario-controller",
                "startedAt", Instant.now().toString()
        );
        redisTemplate.opsForHash().putAll(REDIS_KEY_SLOW_QUERY, hash);

        return ApiResponse.ok(Map.of(
                "scenario", "slow-query",
                "status", "enabled",
                "joinTable", req.joinTable(),
                "targetServices", targetServices
        ));
    }

    @PostMapping("/slow-query/disable")
    public ApiResponse<Map<String, Object>> disableSlowQuery() {
        redisTemplate.delete(REDIS_KEY_SLOW_QUERY);
        return ApiResponse.ok(Map.of("scenario", "slow-query", "status", "disabled"));
    }

    @GetMapping("/slow-query/status")
    public ApiResponse<Map<Object, Object>> slowQueryStatus() {
        Map<Object, Object> hash = redisTemplate.opsForHash().entries(REDIS_KEY_SLOW_QUERY);
        return ApiResponse.ok(hash);
    }

    // ─── Memory Pressure ─────────────────────────────────────────────────

    @PostMapping("/memory-pressure/enable")
    public ApiResponse<Map<String, Object>> enableMemoryPressure(@RequestBody MemoryPressureRequest req) {
        String targetServices = req.targetServices() != null
                ? String.join(",", req.targetServices()) : "";
        Map<String, String> hash = Map.of(
                "enabled", "true",
                "targetServices", targetServices,
                "bufferSizeKb", String.valueOf(req.bufferSizeKb()),
                "operator", "scenario-controller",
                "startedAt", Instant.now().toString()
        );
        redisTemplate.opsForHash().putAll(REDIS_KEY_MEMORY, hash);

        return ApiResponse.ok(Map.of(
                "scenario", "memory-pressure",
                "status", "enabled",
                "bufferSizeKb", req.bufferSizeKb(),
                "targetServices", targetServices
        ));
    }

    @PostMapping("/memory-pressure/disable")
    public ApiResponse<Map<String, Object>> disableMemoryPressure() {
        redisTemplate.delete(REDIS_KEY_MEMORY);
        return ApiResponse.ok(Map.of("scenario", "memory-pressure", "status", "disabled"));
    }

    @GetMapping("/memory-pressure/status")
    public ApiResponse<Map<Object, Object>> memoryPressureStatus() {
        Map<Object, Object> hash = redisTemplate.opsForHash().entries(REDIS_KEY_MEMORY);
        return ApiResponse.ok(hash);
    }
}
