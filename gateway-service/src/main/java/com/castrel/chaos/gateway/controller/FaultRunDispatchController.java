package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.gateway.service.FaultRunDispatchService;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/internal/gateway/fault-runs")
public class FaultRunDispatchController {

    private static final Map<String, Target> TARGETS = Map.ofEntries(
            Map.entry("BROWSE_REPORT_SQL", new Target("catalog-service", "products-browse-report", "/internal/catalog/fault-runs/start", "/internal/catalog/fault-runs/stop")),
            Map.entry("ORDER_REPORT_SQL", new Target("order-service", "orders-query-report", "/internal/orders/fault-runs/start", "/internal/orders/fault-runs/stop")),
            Map.entry("CART_REDIS_LARGE_VALUE", new Target("cart-service", "cart-large-value", "/internal/cart/fault-runs/start", "/internal/cart/fault-runs/stop")),
            Map.entry("CART_CATALOG_DEPENDENCY", new Target("catalog-service", "cart-product-validation", "/internal/catalog/fault-runs/start", "/internal/catalog/fault-runs/stop")),
            Map.entry("NOTIFICATION_HEAP_PRESSURE", new Target("notification-service", "notification-retention", "/internal/notification/fault-runs/start", "/internal/notification/fault-runs/stop")),
            Map.entry("NOTIFICATION_STORAGE_APPEND", new Target("notification-service", "notification-storage", "/internal/notification/fault-runs/start", "/internal/notification/fault-runs/stop")),
            Map.entry("PROMOTION_LOCK_CONTENTION", new Target("promotion-service", "coupon-reservation-consistency", "/internal/promotion/fault-runs/start", "/internal/promotion/fault-runs/stop")),
            Map.entry("INVENTORY_TABLE_EXCLUSIVE", new Target("inventory-service", "inventory-availability-report", "/internal/inventory/fault-runs/start", "/internal/inventory/fault-runs/stop")),
            Map.entry("PSP_PROVIDER_OUTCOME", new Target("psp-simulator", "provider-outcome", "/internal/psp/fault-runs/start", "/internal/psp/fault-runs/stop"))
    );

    private static final Set<String> REQUIRED_FIELDS = Set.of(
            "faultRunId", "scenario", "operation", "parameters", "expiresAt", "fencingToken", "idempotencyKey");
    private static final Set<String> CLEANUP_FIELDS = Set.of("faultRunId", "scenario", "targetService", "fencingToken");

    private final FaultRunDispatchService dispatchService;

    public FaultRunDispatchController(FaultRunDispatchService dispatchService) {
        this.dispatchService = dispatchService;
    }

    @PostMapping("/start")
    public Mono<ApiResponse<Object>> start(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        Validation validation = validate(body, false);
        if (!validation.valid()) return Mono.just(ApiResponse.error(400, validation.message()));
        Target target = validation.target();
        return dispatchService.start(target.service(), target.startPath(), body, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorResume(error -> Mono.just(ApiResponse.error(502, "Fixed target unavailable")));
    }

    @PostMapping("/stop")
    public Mono<ApiResponse<Object>> stop(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        Validation validation = validate(body, false);
        if (!validation.valid()) return Mono.just(ApiResponse.error(400, validation.message()));
        Target target = validation.target();
        return dispatchService.stop(target.service(), target.stopPath(), body, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorResume(error -> Mono.just(ApiResponse.error(502, "Fixed target unavailable")));
    }

    @PostMapping("/cleanup")
    public Mono<ApiResponse<Object>> cleanup(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        if (!body.keySet().equals(CLEANUP_FIELDS)) {
            return Mono.just(ApiResponse.error(400, "Invalid cleanup contract"));
        }
        Validation validation = validate(body, true);
        if (!validation.valid()) return Mono.just(ApiResponse.error(400, validation.message()));
        Target target = validation.target();
        return dispatchService.cleanup(target.service(), target.stopPath(), body, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorResume(error -> Mono.just(ApiResponse.error(502, "Fixed target unavailable")));
    }

    @PostMapping("/restart-notification")
    public Mono<ApiResponse<Object>> restartNotification(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        if (!body.keySet().equals(Set.of("faultRunId", "fencingToken"))
                || !isUuid(body.get("faultRunId"))
                || !isPositiveLong(body.get("fencingToken"))) {
            return Mono.just(ApiResponse.error(400, "Invalid notification restart contract"));
        }
        Map<String, Object> fixedBody = new LinkedHashMap<>(body);
        fixedBody.put("scenario", "NOTIFICATION_HEAP_PRESSURE");
        fixedBody.put("operation", "notification-service-restart");
        Target target = TARGETS.get("NOTIFICATION_HEAP_PRESSURE");
        return dispatchService.cleanup(target.service(), "/internal/notification/fault-runs/restart", fixedBody, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorResume(error -> Mono.just(ApiResponse.error(502, "Fixed notification target unavailable")));
    }

    private Validation validate(Map<String, Object> body, boolean cleanup) {
        if (body == null || !body.keySet().equals(cleanup ? CLEANUP_FIELDS : REQUIRED_FIELDS)) {
            return Validation.invalid("Invalid Fault Run contract");
        }
        Validation identity = validateIdentity(body, !cleanup);
        if (!identity.valid()) return identity;
        String scenario = String.valueOf(body.get("scenario"));
        Target target = TARGETS.get(scenario);
        if (target == null) return Validation.invalid("Unknown Fault Run scenario");
        if (cleanup && !target.service().equals(body.get("targetService"))) {
            return Validation.invalid("Fixed target service does not match scenario");
        }
        if (!cleanup && !target.operation().equals(body.get("operation"))) {
            return Validation.invalid("Fixed target operation does not match scenario");
        }
        return new Validation(true, "", target);
    }

    private Validation validateIdentity(Map<String, Object> body, boolean requireRuntimeFields) {
        if (!isUuid(body.get("faultRunId"))) return Validation.invalid("faultRunId is invalid");
        if (!isPositiveLong(body.get("fencingToken"))) return Validation.invalid("fencingToken is invalid");
        if (requireRuntimeFields && (!(body.get("expiresAt") instanceof String expiresAt) || !isTimestamp(expiresAt))) {
            return Validation.invalid("expiresAt is invalid");
        }
        if (requireRuntimeFields && body.containsKey("idempotencyKey")
                && (!(body.get("idempotencyKey") instanceof String key)
                || !key.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}"))) {
            return Validation.invalid("idempotencyKey is invalid");
        }
        return Validation.valid(null);
    }

    private static boolean isTimestamp(String value) {
        try {
            Instant.parse(value);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isUuid(Object value) {
        try {
            UUID.fromString(String.valueOf(value));
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isPositiveLong(Object value) {
        if (!(value instanceof Number number)) return false;
        return number.longValue() > 0 && number.doubleValue() == number.longValue();
    }

    private static String traceIdOrEmpty(String traceId) {
        return traceId == null ? "" : traceId;
    }

    private record Target(String service, String operation, String startPath, String stopPath) {
    }

    private record Validation(boolean valid, String message, Target target) {
        static Validation valid(Target target) {
            return new Validation(true, "", target);
        }

        static Validation invalid(String message) {
            return new Validation(false, message, null);
        }
    }
}
