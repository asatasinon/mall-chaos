package com.castrel.chaos.risk.dto;

import lombok.Data;

@Data
public class RiskResultDTO {
    private boolean pass;
    private String riskLevel; // LOW / MEDIUM / HIGH
    private String reason;
    private String action;  // FREEZE (for post-pay check)
}
