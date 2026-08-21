package com.castrel.chaos.inventory.dto;

import lombok.Data;

@Data
public class ReserveRequest {
    private String orderId;
    private String sku;
    private int qty;
    private String reservationId;
    private String operationId;
}
