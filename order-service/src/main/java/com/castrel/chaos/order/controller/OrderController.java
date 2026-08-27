package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeValidator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.order.dto.OrderDTO;
import com.castrel.chaos.order.dto.CheckoutCommand;
import com.castrel.chaos.order.dto.PaymentResultRequest;
import com.castrel.chaos.order.dto.RiskRejectedRequest;
import com.castrel.chaos.order.dto.OrderQueryReportDTO;
import com.castrel.chaos.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;

import java.util.Map;
import java.util.List;

@RestController
public class OrderController {

    @Autowired
    private OrderService orderService;

    @Autowired
    private ObjectMapper objectMapper;

    @PostMapping("/api/checkout")
    public ApiResponse<OrderDTO> checkout(
            @RequestHeader("X-User-Id") Long customerId,
            @RequestBody CheckoutCommand command) {
        return ApiResponse.ok(orderService.checkout(customerId, command));
    }

    @GetMapping("/api/orders/{id}")
    public ApiResponse<OrderDTO> getOrder(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long id) {
        return ApiResponse.ok(orderService.getCustomerOrder(customerId, id));
    }

    @GetMapping("/internal/orders/{id}")
    public ApiResponse<OrderDTO> getInternalOrder(@PathVariable Long id) {
        return ApiResponse.ok(orderService.getOrder(id));
    }

    @GetMapping("/api/orders")
    public ApiResponse<Page<OrderDTO>> listOrders(
            @RequestHeader("X-User-Id") Long customerId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(orderService.listCustomerOrders(
                customerId, PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100))));
    }

    @GetMapping("/api/orders/query-report")
    public ApiResponse<List<OrderQueryReportDTO>> queryReport(
            @RequestHeader("X-User-Id") Long customerId) {
        return ApiResponse.ok(orderService.queryReport(customerId));
    }

    @PostMapping("/api/orders/{id}/cancel")
    public ApiResponse<OrderDTO> cancelOrderPublic(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long id) {
        return ApiResponse.ok(orderService.cancelCustomerOrder(customerId, id));
    }

    @PostMapping("/api/orders/{id}/payment-retry")
    public ApiResponse<Map<String, Object>> retryPayment(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long id) {
        return ApiResponse.ok(orderService.retryCustomerPayment(customerId, id));
    }

    @PostMapping("/internal/orders/{id}/expire")
    public ApiResponse<OrderDTO> expire(@PathVariable Long id) {
        return ApiResponse.ok(orderService.expireOrder(id));
    }

    @PostMapping("/internal/orders/risk-rejected")
    public ApiResponse<OrderDTO> riskRejected(@RequestBody EventEnvelope<JsonNode> envelope) {
        EventEnvelopeValidator.validate(envelope);
        if (!"POST_PAYMENT_RISK_REJECTED".equals(envelope.getEventType())) {
            throw new IllegalArgumentException("Unsupported order event type");
        }
        RiskRejectedRequest request;
        try {
            request = objectMapper.treeToValue(envelope.getPayload(), RiskRejectedRequest.class);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid POST_PAYMENT_RISK_REJECTED event payload", exception);
        }
        return ApiResponse.ok(orderService.applyRiskRejected(request));
    }

    @PostMapping("/internal/orders/{id}/cancel")
    public ApiResponse<OrderDTO> cancelOrder(@PathVariable Long id) {
        return ApiResponse.ok(orderService.cancelOrder(id));
    }

    @PostMapping("/internal/orders/{id}/paid")
    public ApiResponse<OrderDTO> markPaid(
            @PathVariable Long id, @RequestParam String paymentId) {
        return ApiResponse.ok(orderService.markPaid(id, paymentId));
    }

    @PostMapping("/internal/orders/payment-result")
    public ApiResponse<OrderDTO> paymentResult(@RequestBody EventEnvelope<JsonNode> envelope) {
        EventEnvelopeValidator.validate(envelope);
        if (!"PAYMENT_RESULT".equals(envelope.getEventType())) {
            throw new IllegalArgumentException("Unsupported payment event type");
        }
        PaymentResultRequest request;
        try {
            request = objectMapper.treeToValue(envelope.getPayload(), PaymentResultRequest.class);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid PAYMENT_RESULT event payload", exception);
        }
        request.setEventId(envelope.getEventId());
        return ApiResponse.ok(orderService.applyPaymentResult(request));
    }
}
