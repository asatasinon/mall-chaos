package com.castrel.chaos.risk.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeValidator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.risk.dto.PostPayCheckRequest;
import com.castrel.chaos.risk.dto.PreCheckRequest;
import com.castrel.chaos.risk.dto.OrderPaidEventRequest;
import com.castrel.chaos.risk.dto.RiskResultDTO;
import com.castrel.chaos.risk.service.RiskService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class RiskController {

    @Autowired
    private RiskService riskService;

    @Autowired
    private ObjectMapper objectMapper;

    @PostMapping("/internal/risk/pre-check")
    public ApiResponse<RiskResultDTO> preCheck(@RequestBody PreCheckRequest req) {
        return ApiResponse.ok(riskService.preCheck(req));
    }

    @PostMapping("/internal/risk/post-pay-check")
    public ApiResponse<RiskResultDTO> postPayCheck(@RequestBody PostPayCheckRequest req) {
        return ApiResponse.ok(riskService.postPayCheck(req));
    }

    @PostMapping("/internal/risk/events/order-paid")
    public ApiResponse<RiskResultDTO> orderPaid(@RequestBody EventEnvelope<JsonNode> envelope) {
        EventEnvelopeValidator.validate(envelope);
        if (!"ORDER_PAID".equals(envelope.getEventType())) {
            throw new IllegalArgumentException("Unsupported risk event type");
        }
        OrderPaidEventRequest req;
        try {
            req = objectMapper.treeToValue(envelope.getPayload(), OrderPaidEventRequest.class);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid ORDER_PAID event payload", exception);
        }
        req.setEventId(envelope.getEventId());
        PostPayCheckRequest check = new PostPayCheckRequest();
        check.setUserId(req.getUserId());
        check.setOrderId(req.getOrderId());
        check.setOrderNo(req.getOrderNo());
        check.setPaymentId(req.getPaymentId());
        check.setAmount(req.getAmount());
        return ApiResponse.ok(riskService.postPayCheck(check));
    }
}
