package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.gateway.service.FixedOperationDispatchService;
import com.castrel.chaos.gateway.service.ScenarioDispatchService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/internal/gateway")
public class ScenarioDispatchController {

    private static final Map<String, Target> TARGETS = Map.ofEntries(
            Map.entry("BROWSE_REPORT_SQL", new Target("catalog-service", "products-browse-report", "/internal/catalog/reports/product-browse/prepare", "/internal/catalog/reports/product-browse/release", "/internal/catalog/reports/product-browse/cleanup")),
            Map.entry("ORDER_REPORT_SQL", new Target("order-service", "orders-query-report", "/internal/orders/reports/order-query/prepare", "/internal/orders/reports/order-query/release", "/internal/orders/reports/order-query/cleanup")),
            Map.entry("CATALOG_REDIS_LARGE_VALUE", new Target("catalog-service", "catalog-product-detail-large-value", "/internal/catalog/product-details/cache/prepare", "/internal/catalog/product-details/cache/release", "/internal/catalog/product-details/cache/cleanup")),
            Map.entry("CART_CATALOG_DEPENDENCY", new Target("catalog-service", "cart-product-validation", "/internal/catalog/dependencies/cart-product-validation/prepare", "/internal/catalog/dependencies/cart-product-validation/release", "/internal/catalog/dependencies/cart-product-validation/cleanup")),
            Map.entry("NOTIFICATION_HEAP_PRESSURE", new Target("notification-service", "notification-retention", "/internal/notification/retention/prepare", "/internal/notification/retention/release", "/internal/notification/retention/cleanup")),
            Map.entry("NOTIFICATION_STORAGE_APPEND", new Target("notification-service", "notification-storage", "/internal/notification/storage/prepare", "/internal/notification/storage/release", "/internal/notification/storage/cleanup")),
            Map.entry("PROMOTION_LOCK_CONTENTION", new Target("promotion-service", "coupon-reservation-consistency", "/internal/promotion/coupons/reservations/prepare", "/internal/promotion/coupons/reservations/release", "/internal/promotion/coupons/reservations/remove")),
            Map.entry("INVENTORY_TABLE_EXCLUSIVE", new Target("inventory-service", "inventory-availability-report", "/internal/inventory/availability/prepare", "/internal/inventory/availability/release", "/internal/inventory/availability/remove")),
            Map.entry("INVENTORY_ROW_LOCK", new Target("inventory-service", "inventory-reservation-summary", "/internal/inventory/reservations/prepare", "/internal/inventory/reservations/release", "/internal/inventory/reservations/remove")),
            Map.entry("PSP_PROVIDER_OUTCOME", new Target("psp-simulator", "provider-outcome", "/internal/psp/provider-outcome/prepare", "/internal/psp/provider-outcome/release", "/internal/psp/provider-outcome/cleanup"))
    );

    private static final Set<String> REQUIRED_FIELDS = Set.of(
            "runId", "scenario", "operation", "parameters", "expiresAt", "fencingToken", "idempotencyKey");
    private static final Set<String> CLEANUP_FIELDS = Set.of("runId", "scenario", "targetService", "fencingToken");
    private static final Set<String> OBSERVATION_FIELDS = Set.of(
            "runId", "expiresAt", "fencingToken", "idempotencyKey");
    private static final Map<String, String> SCENARIO_CLEANUP_PATHS = Map.of(
            "NOTIFICATION_STORAGE_APPEND", "/internal/notification/storage/cleanup-all");
    private final ScenarioDispatchService dispatchService;
    private final FixedOperationDispatchService operationService;

    public ScenarioDispatchController(ScenarioDispatchService dispatchService,
                                      FixedOperationDispatchService operationService) {
        this.dispatchService = dispatchService;
        this.operationService = operationService;
    }

    @PostMapping("/operations/prepare")
    public Mono<ApiResponse<Object>> prepare(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        Validation validation = validate(body, false);
        if (!validation.valid()) return Mono.just(ApiResponse.error(400, validation.message()));
        Target target = validation.target();
        return dispatchService.prepare(target.service(), target.preparePath(), body, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorMap(error -> targetUnavailable("Fixed target unavailable", error));
    }

    @PostMapping("/operations/release")
    public Mono<ApiResponse<Object>> release(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        Validation validation = validate(body, false);
        if (!validation.valid()) return Mono.just(ApiResponse.error(400, validation.message()));
        Target target = validation.target();
        return dispatchService.release(target.service(), target.releasePath(), body, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorMap(error -> targetUnavailable("Fixed target unavailable", error));
    }

    @PostMapping("/operations/cleanup")
    public Mono<ApiResponse<Object>> cleanup(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        if (body == null || !body.keySet().equals(CLEANUP_FIELDS)) {
            return Mono.just(ApiResponse.error(400, "Invalid cleanup contract"));
        }
        Validation validation = validate(body, true);
        if (!validation.valid()) return Mono.just(ApiResponse.error(400, validation.message()));
        Target target = validation.target();
        return dispatchService.cleanup(target.service(), target.cleanupPath(), body, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorMap(error -> targetUnavailable("Fixed target unavailable", error));
    }

    @PostMapping("/operations/cleanup-all")
    public Mono<ApiResponse<Object>> cleanupAll(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        if (body == null || !body.keySet().equals(Set.of("scenario"))) {
            return Mono.just(ApiResponse.error(400, "Invalid scenario cleanup contract"));
        }
        String scenario = body.get("scenario") instanceof String value ? value : "";
        Target target = TARGETS.get(scenario);
        String cleanupPath = SCENARIO_CLEANUP_PATHS.get(scenario);
        if (target == null || cleanupPath == null) {
            return Mono.just(ApiResponse.error(400, "Scenario does not support cleanup"));
        }
        return dispatchService.cleanup(target.service(), cleanupPath, body, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorMap(error -> targetUnavailable("Fixed target unavailable", error));
    }

    @PostMapping("/notification/restart")
    public Mono<ApiResponse<Object>> restartNotification(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        if (body == null || !body.keySet().equals(Set.of("runId", "fencingToken"))
                || !isUuid(body.get("runId"))
                || !isPositiveLong(body.get("fencingToken"))) {
            return Mono.just(ApiResponse.error(400, "Invalid notification restart contract"));
        }
        Map<String, Object> fixedBody = new LinkedHashMap<>(body);
        fixedBody.put("scenario", "NOTIFICATION_HEAP_PRESSURE");
        fixedBody.put("operation", "notification-service-restart");
        Target target = TARGETS.get("NOTIFICATION_HEAP_PRESSURE");
        return dispatchService.cleanup(target.service(), "/internal/notification/restart", fixedBody, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorMap(error -> targetUnavailable("Fixed notification target unavailable", error));
    }

    @PostMapping("/inventory/availability")
    public Mono<ApiResponse<Object>> inventoryAvailability(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        return dispatchObservation(body, traceId, "inventory-service", "/internal/inventory/availability/report",
                "Fixed inventory target unavailable");
    }

    @PostMapping("/inventory/reservations/summary")
    public Mono<ApiResponse<Object>> inventoryReservationSummary(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        return dispatchObservation(body, traceId, "inventory-service", "/internal/inventory/reservations/summary",
                "Fixed inventory reservation target unavailable");
    }

    @PostMapping("/promotion/consistency")
    public Mono<ApiResponse<Object>> promotionConsistency(
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        return dispatchObservation(body, traceId, "promotion-service", "/internal/promotion/coupons/reservations/consistency",
                "Fixed promotion target unavailable");
    }

    private Mono<ApiResponse<Object>> dispatchObservation(
            Map<String, Object> body, String traceId, String serviceName, String path, String unavailableMessage) {
        Validation validation = validateObservation(body);
        if (!validation.valid()) return Mono.just(ApiResponse.error(400, validation.message()));
        return operationService.dispatch(serviceName, path, body, traceIdOrEmpty(traceId))
                .map(ApiResponse::ok)
                .onErrorMap(error -> targetUnavailable(unavailableMessage, error));
    }

    private Validation validate(Map<String, Object> body, boolean cleanup) {
        if (body == null || !body.keySet().equals(cleanup ? CLEANUP_FIELDS : REQUIRED_FIELDS)) {
            return Validation.invalid("Invalid scenario contract");
        }
        Validation identity = validateIdentity(body, !cleanup);
        if (!identity.valid()) return identity;
        String scenario = String.valueOf(body.get("scenario"));
        Target target = TARGETS.get(scenario);
        if (target == null) return Validation.invalid("Unknown scenario");
        if (cleanup && !target.service().equals(body.get("targetService"))) {
            return Validation.invalid("Fixed target service does not match scenario");
        }
        if (!cleanup && !target.operation().equals(body.get("operation"))) {
            return Validation.invalid("Fixed target operation does not match scenario");
        }
        return new Validation(true, "", target);
    }

    private Validation validateObservation(Map<String, Object> body) {
        if (body == null || !body.keySet().equals(OBSERVATION_FIELDS)) {
            return Validation.invalid("Invalid operation context");
        }
        return validateIdentity(body, true);
    }

    private Validation validateIdentity(Map<String, Object> body, boolean requireRuntimeFields) {
        if (!isUuid(body.get("runId"))) return Validation.invalid("run id is invalid");
        if (!isPositiveLong(body.get("fencingToken"))) return Validation.invalid("fencing token is invalid");
        if (requireRuntimeFields && (!(body.get("expiresAt") instanceof String expiresAt) || !isTimestamp(expiresAt))) {
            return Validation.invalid("expiry time is invalid");
        }
        if (requireRuntimeFields && body.containsKey("idempotencyKey")
                && (!(body.get("idempotencyKey") instanceof String key)
                || !key.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}"))) {
            return Validation.invalid("idempotency key is invalid");
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

    private static ResponseStatusException targetUnavailable(String message, Throwable cause) {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY, message, cause);
    }

    private record Target(String service, String operation, String preparePath, String releasePath, String cleanupPath) {
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