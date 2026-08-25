package com.castrel.chaos.payment.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.payment.dto.PaymentDTO;
import com.castrel.chaos.payment.dto.PaymentIntentRequest;
import com.castrel.chaos.payment.dto.RefundRequest;
import com.castrel.chaos.payment.service.PaymentService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class PaymentController {

    @Autowired
    private PaymentService paymentService;

    @PostMapping("/api/orders/{orderId}/payment-intents")
    public ApiResponse<PaymentDTO> createIntent(
            @RequestHeader("X-User-Id") Long customerId,
            @PathVariable Long orderId,
            @RequestBody PaymentIntentRequest request) {
        request.setOrderId(orderId);
        request.setUserId(customerId);
        return ApiResponse.ok(paymentService.createIntent(request));
    }

    @PostMapping("/api/payments/{id}/confirm")
    public ApiResponse<PaymentDTO> confirm(
            @PathVariable Long id,
            @RequestHeader("X-User-Id") Long customerId) {
        return ApiResponse.ok(paymentService.confirmIntent(id, customerId, true));
    }

    @PostMapping("/api/payments/{id}/retry")
    public ApiResponse<PaymentDTO> retry(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long id) {
        return ApiResponse.ok(paymentService.retryIntent(id, customerId));
    }

    @PostMapping("/internal/payments/{id}/retry")
    public ApiResponse<PaymentDTO> internalRetry(@PathVariable Long id) {
        return ApiResponse.ok(paymentService.retryIntent(id));
    }

    @PostMapping("/internal/payments/{id}/refund")
    public ApiResponse<PaymentDTO> refund(
            @PathVariable Long id,
            @RequestHeader("X-Auth-Actor") String actor,
            @RequestBody RefundRequest request) {
        return ApiResponse.ok(paymentService.refund(id, request, actor));
    }

    @GetMapping("/internal/payments/{id}")
    public ApiResponse<PaymentDTO> getPayment(@PathVariable Long id) {
        return ApiResponse.ok(paymentService.getPayment(id));
    }
}
