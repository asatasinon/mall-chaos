package com.castrel.chaos.cart.dto;

import lombok.Data;

@Data
public class CartItemRequest {
    private String sku;
    private Integer quantity;
}
