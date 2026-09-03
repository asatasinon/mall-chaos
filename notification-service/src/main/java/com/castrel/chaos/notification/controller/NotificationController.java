package com.castrel.chaos.notification.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeValidator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.notification.dto.PaymentResultRequest;
import com.castrel.chaos.notification.dto.ShippingCreatedRequest;
import com.castrel.chaos.notification.service.NotificationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import com.castrel.chaos.notification.dto.CustomerNotificationDTO;
import com.castrel.chaos.notification.dto.NotificationPreferenceDTO;
import com.castrel.chaos.notification.dto.UpdateNotificationPreferenceRequest;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import com.castrel.chaos.notification.service.NotificationRetentionState;
import com.castrel.chaos.notification.repository.CustomerNotificationRepository;
import java.util.Map;

@RestController
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private NotificationRetentionState retentionState;

    @Autowired
    private ScenarioRunGuard runGuard;

    @Autowired
    private CustomerNotificationRepository customerNotificationRepository;

    @GetMapping("/api/notifications")
    public ApiResponse<Page<CustomerNotificationDTO>> list(
            @RequestHeader("X-User-Id") Long customerId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(notificationService.listCustomerNotifications(customerId,
                PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100))));
    }

    @PatchMapping("/api/notifications/{id}/read")
    public ApiResponse<CustomerNotificationDTO> read(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long id) {
        return ApiResponse.ok(notificationService.markRead(customerId, id));
    }

    @GetMapping("/api/notifications/preferences")
    public ApiResponse<NotificationPreferenceDTO> preferences(@RequestHeader("X-User-Id") Long customerId) {
        return ApiResponse.ok(notificationService.getPreferences(customerId));
    }

    @PatchMapping("/api/notifications/preferences")
    public ApiResponse<NotificationPreferenceDTO> updatePreferences(
            @RequestHeader("X-User-Id") Long customerId,
            @RequestBody UpdateNotificationPreferenceRequest request) {
        return ApiResponse.ok(notificationService.updatePreferences(customerId, request));
    }

    @PostMapping("/internal/notifications/payment-result")
    public ApiResponse<Void> paymentResult(@RequestBody EventEnvelope<JsonNode> envelope) {
        EventEnvelopeValidator.validate(envelope);
        if (!"ORDER_PAID".equals(envelope.getEventType())
                && !"ORDER_PAYMENT_FAILED".equals(envelope.getEventType())) {
            throw new IllegalArgumentException("Unsupported notification event type");
        }
        PaymentResultRequest req = toRequest(envelope, PaymentResultRequest.class);
        req.setEventId(envelope.getEventId());
        req.setSuccess("ORDER_PAID".equals(envelope.getEventType()));
        notificationService.notifyPaymentResult(req);
        return ApiResponse.ok();
    }

    @PostMapping("/internal/notifications/shipping-created")
    public ApiResponse<Void> shippingCreated(@RequestBody EventEnvelope<JsonNode> envelope) {
        EventEnvelopeValidator.validate(envelope);
        if (!"SHIPMENT_UPDATED".equals(envelope.getEventType())) {
            throw new IllegalArgumentException("Unsupported notification event type");
        }
        ShippingCreatedRequest req = toRequest(envelope, ShippingCreatedRequest.class);
        req.setEventId(envelope.getEventId());
        notificationService.notifyShippingCreated(req);
        return ApiResponse.ok();
    }

        @PostMapping("/internal/notification/retention/prepare")
        public ApiResponse<Map<String, Object>> prepareRetention(
            @RequestHeader("X-Scenario-Run-Scenario") String scenario,
            @RequestHeader("X-Scenario-Run-Operation") String operation,
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody Map<String, Object> parameters) {
        if ((!"NOTIFICATION_HEAP_PRESSURE".equals(scenario) || !"notification-retention".equals(operation))
                && (!"NOTIFICATION_STORAGE_APPEND".equals(scenario) || !"notification-storage".equals(operation))) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported notification operation");
        }
        if (!"NOTIFICATION_HEAP_PRESSURE".equals(scenario) || !"notification-retention".equals(operation)) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported notification retention operation");
        }
        retentionState.prepare(ScenarioRunContext.fromHeaders(headers), scenario, parameters, runGuard);
        return ApiResponse.ok(Map.of("accepted", true, "scenario", scenario));
    }

    @PostMapping("/internal/notification/retention/release")
    public ApiResponse<Map<String, Object>> releaseRetention(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        retentionState.release(context, runGuard);
        return ApiResponse.ok(Map.of("released", true, "runId", context.runId(),
            "retainedEntries", retentionState.retainedEntries()));
    }

    @PostMapping("/internal/notification/retention/cleanup")
    public ApiResponse<Map<String, Object>> cleanupRetention(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        ScenarioRunContext context = ScenarioRunContext.fromHeaders(headers);
        retentionState.release(context, runGuard);
        long deleted = customerNotificationRepository.deleteByOperationRunId(context.runId());
        return ApiResponse.ok(Map.of("cleaned", true, "deletedNotifications", deleted));
    }

    @PostMapping("/internal/notification/storage/cleanup-all")
    public ApiResponse<Map<String, Object>> cleanupAllStorage(
            @RequestBody Map<String, Object> body) {
        if (body == null || !"NOTIFICATION_STORAGE_APPEND".equals(body.get("scenario")) || body.size() != 1) {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported notification scenario cleanup");
        }
        retentionState.stopAllStorageOperations(runGuard);
        long deleted = customerNotificationRepository.deleteByOperationRunIdIsNotNull();
        return ApiResponse.ok(Map.of("cleaned", true, "deletedNotifications", deleted));
    }

    @PostMapping("/internal/notification/restart")
    public ApiResponse<Map<String, Object>> restartNotificationService() {
        return ApiResponse.ok(Map.of("restartRequested", true, "target", "notification-service"));
    }

    private <T> T toRequest(EventEnvelope<JsonNode> envelope, Class<T> type) {
        try {
            return objectMapper.treeToValue(envelope.getPayload(), type);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid notification event payload", exception);
        }
    }
}
