package com.castrel.chaos.order.dto;

import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class OrderQueryReportDTO {
    private String orderNo;
    private String status;
    private BigDecimal totalAmount;
    private LocalDateTime createdAt;
    private Long itemCount;
    private Long totalQuantity;
}
