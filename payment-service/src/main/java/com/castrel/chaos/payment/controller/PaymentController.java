package com.castrel.chaos.payment.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.payment.dto.ChargeRequest;
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

    @PostMapping("/api/payments/intents")
    public ApiResponse<PaymentDTO> createIntent(
            @RequestHeader("X-User-Id") Long customerId,
            @RequestBody PaymentIntentRequest request) {
        request.setUserId(customerId);
        return ApiResponse.ok(paymentService.createIntent(request));
    }

    @PostMapping("/api/payments/{id}/confirm")
    public ApiResponse<PaymentDTO> confirm(@PathVariable Long id) {
        return ApiResponse.ok(paymentService.confirmIntent(id));
    }

    @PostMapping("/api/payments/{id}/retry")
    public ApiResponse<PaymentDTO> retry(@PathVariable Long id) {
        return ApiResponse.ok(paymentService.retryIntent(id));
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

    @PostMapping("/internal/payments/charge")
    public ApiResponse<PaymentDTO> charge(@RequestBody ChargeRequest req) {
        return ApiResponse.ok(paymentService.charge(req));
    }

    @GetMapping("/internal/payments/{id}")
    public ApiResponse<PaymentDTO> getPayment(@PathVariable Long id) {
        return ApiResponse.ok(paymentService.getPayment(id));
    }
}
