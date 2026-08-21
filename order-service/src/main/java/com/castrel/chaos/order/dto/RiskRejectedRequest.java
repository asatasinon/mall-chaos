package com.castrel.chaos.order.dto;

import lombok.Data;

@Data
public class RiskRejectedRequest {
    private String orderNo;
    private String reason;
}
