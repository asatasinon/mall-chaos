package com.castrel.chaos.inventory.dto;

import lombok.Data;

@Data
public class InventoryOperationRequest {
    private String orderId;
    private String sku;
    private String reservationId;
    private String operationId;
}