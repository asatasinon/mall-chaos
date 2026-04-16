package com.castrel.chaos.payment.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.payment.dto.ChargeRequest;
import com.castrel.chaos.payment.dto.PaymentDTO;
import com.castrel.chaos.payment.service.PaymentService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class PaymentController {

    @Autowired
    private PaymentService paymentService;

    @PostMapping("/internal/payments/charge")
    public ApiResponse<PaymentDTO> charge(@RequestBody ChargeRequest req) {
        return ApiResponse.ok(paymentService.charge(req));
    }

    @GetMapping("/internal/payments/{id}")
    public ApiResponse<PaymentDTO> getPayment(@PathVariable Long id) {
        return ApiResponse.ok(paymentService.getPayment(id));
    }
}
