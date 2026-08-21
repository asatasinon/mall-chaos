package com.castrel.chaos.notification.dto;

import lombok.Data;

@Data
public class ShippingCreatedRequest {
    private String eventId;
    private Long userId;
    private String orderNo;
    private String trackingNo;
    private String carrier;
}
