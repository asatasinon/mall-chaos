package com.castrel.chaos.fulfillment.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeValidator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.fulfillment.dto.CancelFulfillmentRequest;
import com.castrel.chaos.fulfillment.dto.CreateFulfillmentRequest;
import com.castrel.chaos.fulfillment.dto.FulfillmentDTO;
import com.castrel.chaos.fulfillment.dto.RiskPassedEventRequest;
import com.castrel.chaos.fulfillment.service.FulfillmentService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class FulfillmentController {

    @Autowired
    private FulfillmentService fulfillmentService;

    @Autowired
    private ObjectMapper objectMapper;

    @GetMapping("/api/fulfillments/{orderId}")
    public ApiResponse<FulfillmentDTO> getByOrderId(@PathVariable Long orderId) {
        return ApiResponse.ok(fulfillmentService.getByOrderId(orderId));
    }

    @PostMapping("/api/fulfillments/{orderId}/confirm-delivery")
    public ApiResponse<FulfillmentDTO> confirmDelivery(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long orderId) {
        return ApiResponse.ok(fulfillmentService.confirmDelivery(customerId, orderId));
    }

    @PostMapping("/internal/fulfillments/create")
    public ApiResponse<FulfillmentDTO> create(@RequestBody CreateFulfillmentRequest req) {
        return ApiResponse.ok(fulfillmentService.create(req));
    }

    @PostMapping("/internal/fulfillments/events/risk-passed")
    public ApiResponse<FulfillmentDTO> riskPassed(@RequestBody EventEnvelope<JsonNode> envelope) {
        EventEnvelopeValidator.validate(envelope);
        if (!"POST_PAYMENT_RISK_PASSED".equals(envelope.getEventType())) {
            throw new IllegalArgumentException("Unsupported fulfillment event type");
        }
        RiskPassedEventRequest request;
        try {
            request = objectMapper.treeToValue(envelope.getPayload(), RiskPassedEventRequest.class);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid POST_PAYMENT_RISK_PASSED event payload", exception);
        }
        request.setEventId(envelope.getEventId());
        CreateFulfillmentRequest create = new CreateFulfillmentRequest();
        create.setOrderId(request.getOrderId());
        create.setUserId(request.getUserId());
        create.setOrderNo(request.getOrderNo());
        return ApiResponse.ok(fulfillmentService.create(create));
    }

    @PostMapping("/internal/fulfillments/cancel")
    public ApiResponse<FulfillmentDTO> cancel(@RequestBody CancelFulfillmentRequest req) {
        return ApiResponse.ok(fulfillmentService.cancel(req));
    }
}
