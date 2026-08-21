package com.castrel.chaos.notification.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.notification.dto.OrderCreatedRequest;
import com.castrel.chaos.notification.dto.PaymentResultRequest;
import com.castrel.chaos.notification.dto.ShippingCreatedRequest;
import com.castrel.chaos.notification.service.NotificationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import com.castrel.chaos.notification.dto.CustomerNotificationDTO;

@RestController
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

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

    @PostMapping("/internal/notifications/order-created")
    public ApiResponse<Void> orderCreated(@RequestBody OrderCreatedRequest req) {
        notificationService.notifyOrderCreated(req);
        return ApiResponse.ok();
    }

    @PostMapping("/internal/notifications/payment-result")
    public ApiResponse<Void> paymentResult(@RequestBody PaymentResultRequest req) {
        notificationService.notifyPaymentResult(req);
        return ApiResponse.ok();
    }

    @PostMapping("/internal/notifications/shipping-created")
    public ApiResponse<Void> shippingCreated(@RequestBody ShippingCreatedRequest req) {
        notificationService.notifyShippingCreated(req);
        return ApiResponse.ok();
    }
}
