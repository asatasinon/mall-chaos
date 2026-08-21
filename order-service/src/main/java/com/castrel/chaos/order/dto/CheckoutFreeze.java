package com.castrel.chaos.order.dto;

import lombok.Data;

import java.util.List;

@Data
public class CheckoutFreeze {
    private String checkoutId;
    private String freezeToken;
    private Long cartId;
    private Integer cartVersion;
    private List<CheckoutItem> items;
}
