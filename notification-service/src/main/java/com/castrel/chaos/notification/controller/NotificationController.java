package com.castrel.chaos.notification.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.notification.dto.OrderCreatedRequest;
import com.castrel.chaos.notification.dto.PaymentResultRequest;
import com.castrel.chaos.notification.dto.ShippingCreatedRequest;
import com.castrel.chaos.notification.service.NotificationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

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
