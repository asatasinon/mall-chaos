package com.castrel.chaos.fulfillment.dto;

import lombok.Data;

@Data
public class CreateFulfillmentRequest {
    private Long orderId;
    private String orderNo;
    private Long userId;
}
