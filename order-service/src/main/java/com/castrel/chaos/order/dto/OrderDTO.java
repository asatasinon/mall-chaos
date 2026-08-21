package com.castrel.chaos.order.dto;

import lombok.Data;

import java.math.BigDecimal;
import java.util.List;

@Data
public class OrderDTO {
    private Long id;
    private String orderNo;
    private Long userId;
    private String sku;
    private Integer qty;
    private BigDecimal amount;
    private String status;
    private String paymentId;
    private String failReason;
    private BigDecimal subtotal;
    private BigDecimal discountAmount;
    private BigDecimal totalAmount;
    private Long addressId;
    private Long couponId;
    private Integer version;
    private List<OrderItemDTO> items;
}
