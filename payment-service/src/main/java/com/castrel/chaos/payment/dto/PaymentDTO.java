package com.castrel.chaos.payment.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class PaymentDTO {
    private Long id;
    private String paymentNo;
    private String orderNo;
    private BigDecimal amount;
    private String status;
    private String resultCode;
    private String failReason;
}
