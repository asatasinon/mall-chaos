package com.castrel.chaos.fulfillment.dto;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class FulfillmentDTO {
    private Long id;
    private Long orderId;
    private String orderNo;
    private String status;
    private String trackingNo;
    private String carrier;
    private LocalDateTime shippedAt;
    private LocalDateTime deliveredAt;
    private LocalDateTime createdAt;
}
