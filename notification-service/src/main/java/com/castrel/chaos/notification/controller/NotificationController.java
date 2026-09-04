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
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
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
    private OperationRunGuard runGuard;

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
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody(required = false) Map<String, Object> parameters) {
        retentionState.prepareRetention(OperationRunContext.fromHeaders(headers), parameters, runGuard);
        return ApiResponse.ok(Map.of("accepted", true, "operation", "notification-retention"));
    }

    @PostMapping("/internal/notification/retention/release")
    public ApiResponse<Map<String, Object>> releaseRetention(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        retentionState.release(context, runGuard);
        return ApiResponse.ok(Map.of("released", true, "runId", context.runId(),
            "retainedEntries", retentionState.retainedEntries()));
    }

    @PostMapping("/internal/notification/storage/prepare")
    public ApiResponse<Map<String, Object>> prepareStorage(
            @RequestHeader org.springframework.http.HttpHeaders headers,
            @RequestBody(required = false) Map<String, Object> parameters) {
        retentionState.prepareStorage(OperationRunContext.fromHeaders(headers), parameters, runGuard);
        return ApiResponse.ok(Map.of("accepted", true, "operation", "notification-storage"));
    }

    @PostMapping("/internal/notification/storage/release")
    public ApiResponse<Map<String, Object>> releaseStorage(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        retentionState.release(context, runGuard);
        return ApiResponse.ok(Map.of("released", true, "runId", context.runId()));
    }

    @PostMapping("/internal/notification/storage/append")
    public ApiResponse<Map<String, Object>> appendStorage(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        long sizeBytes = retentionState.appendStorage(context, runGuard);
        return ApiResponse.ok(Map.of("accepted", true, "operation", "notification-storage",
            "runId", context.runId(), "sizeBytes", sizeBytes));
    }

    @PostMapping("/internal/notification/retention/cleanup")
    public ApiResponse<Map<String, Object>> cleanupRetention(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        retentionState.release(context, runGuard);
        long deleted = customerNotificationRepository.deleteByOperationRunId(context.runId());
        return ApiResponse.ok(Map.of("cleaned", true, "deletedNotifications", deleted));
    }

    @PostMapping("/internal/notification/storage/cleanup")
    public ApiResponse<Map<String, Object>> cleanupStorage(
            @RequestHeader org.springframework.http.HttpHeaders headers) {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);
        long deletedBytes = retentionState.cleanupStorage(context, runGuard);
        return ApiResponse.ok(Map.of("cleaned", true, "deletedBytes", deletedBytes));
    }

    @PostMapping("/internal/notification/storage/cleanup-all")
    public ApiResponse<Map<String, Object>> cleanupAllStorage(
            @RequestBody Map<String, Object> body) {
        if (body == null || !"notification-storage".equals(body.get("operation")) || body.size() != 1) {
            throw new BizException("OPERATION_MISMATCH", "Unsupported notification storage cleanup");
        }
        long deletedBytes = retentionState.cleanupAllStorage(runGuard);
        return ApiResponse.ok(Map.of("cleaned", true, "deletedBytes", deletedBytes));
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
