package com.castrel.chaos.fulfillment.dto;

import lombok.Data;

@Data
public class RiskPassedEventRequest {
    private String eventId;
    private Long orderId;
    private Long userId;
    private String orderNo;
}