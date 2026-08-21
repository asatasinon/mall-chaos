package com.castrel.chaos.cart.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
@AllArgsConstructor
public class CheckoutFreezeDTO {
    private String checkoutId;
    private String freezeToken;
    private Long cartId;
    private Integer cartVersion;
    private List<CartItemDTO> items;
}
