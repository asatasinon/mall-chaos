package com.castrel.chaos.fulfillment.dto;

import lombok.Data;

@Data
public class CancelFulfillmentRequest {
    private Long orderId;
    private String reason;
}
