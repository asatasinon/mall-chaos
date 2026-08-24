package com.castrel.chaos.payment.service;

import com.castrel.chaos.payment.client.OrderPaymentResultClient;
import com.castrel.chaos.common.event.EventEnvelope;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

@Component
public class PaymentResultDelivery {
    private final OrderPaymentResultClient client;

    public PaymentResultDelivery(OrderPaymentResultClient client) {
        this.client = client;
    }

    public void deliver(EventEnvelope<JsonNode> envelope) {
        client.publish(envelope);
    }
}