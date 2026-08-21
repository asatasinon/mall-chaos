package com.castrel.chaos.payment.service;

import com.castrel.chaos.payment.client.OrderPaymentResultClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.payment.dto.PaymentDTO;
import org.springframework.stereotype.Component;

@Component
public class PaymentResultDelivery {
    private final OrderPaymentResultClient client;
    private final ObjectMapper mapper;

    public PaymentResultDelivery(OrderPaymentResultClient client, ObjectMapper mapper) {
        this.client = client;
        this.mapper = mapper;
    }

    public void deliver(JsonNode payload) {
        client.publish(mapper.convertValue(payload, PaymentDTO.class));
    }
}