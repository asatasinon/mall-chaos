package com.castrel.chaos.order.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
public class PaymentResultRequest {
    private String eventId;
    private String orderNo;
    @JsonProperty("id")
    private Long paymentId;
    private String paymentNo;
    private String status;
    private String resultCode;
}