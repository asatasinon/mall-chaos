package com.castrel.chaos.order.dto;

import lombok.Data;

@Data
public class PaymentResultRequest {
    private String eventId;
    private String orderNo;
    private String paymentNo;
    private String status;
    private String resultCode;
}