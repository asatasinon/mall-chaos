package com.castrel.chaos.payment.dto;

import lombok.Data;

@Data
public class PaymentResultRequest {
    private String orderNo;
    private String paymentNo;
    private String status;
    private String resultCode;
}