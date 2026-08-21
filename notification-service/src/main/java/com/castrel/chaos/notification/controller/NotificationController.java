package com.castrel.chaos.notification.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeValidator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.notification.dto.OrderCreatedRequest;
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

@RestController
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private ObjectMapper objectMapper;

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

    @PostMapping("/internal/notifications/order-created")
    public ApiResponse<Void> orderCreated(@RequestBody OrderCreatedRequest req) {
        notificationService.notifyOrderCreated(req);
        return ApiResponse.ok();
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

    private <T> T toRequest(EventEnvelope<JsonNode> envelope, Class<T> type) {
        try {
            return objectMapper.treeToValue(envelope.getPayload(), type);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid notification event payload", exception);
        }
    }
}
