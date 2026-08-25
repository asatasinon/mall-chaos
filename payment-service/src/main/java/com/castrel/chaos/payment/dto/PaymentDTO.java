package com.castrel.chaos.payment.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class PaymentDTO {
    private String eventId;
    private Long id;
    private String paymentNo;
    private Long orderId;
    private String orderNo;
    private Long customerId;
    private BigDecimal amount;
    private String status;
    private String resultCode;
    private String failReason;
}
