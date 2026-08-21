package com.castrel.chaos.order.dto;

import lombok.Data;

@Data
public class CheckoutCommand {
    private String idempotencyKey;
    private Long cartId;
    private Integer cartVersion;
    private Long addressId;
    private Long couponId;
}
