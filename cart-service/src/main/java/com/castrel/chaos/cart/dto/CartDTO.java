package com.castrel.chaos.cart.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
@AllArgsConstructor
public class CartDTO {
    private Long id;
    private Long customerId;
    private Integer version;
    private List<CartItemDTO> items;
}
