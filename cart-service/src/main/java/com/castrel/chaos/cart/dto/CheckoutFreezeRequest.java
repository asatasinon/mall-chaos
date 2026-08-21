package com.castrel.chaos.cart.dto;

import lombok.Data;

@Data
public class CheckoutFreezeRequest {
    private String checkoutId;
    private Long cartId;
    private Integer cartVersion;
}
