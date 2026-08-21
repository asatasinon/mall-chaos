package com.castrel.chaos.cart.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class CartItemDTO {
    private Long id;
    private String sku;
    private Integer quantity;
}
