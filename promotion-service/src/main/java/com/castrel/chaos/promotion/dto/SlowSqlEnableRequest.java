package com.castrel.chaos.promotion.dto;

import lombok.Data;

@Data
public class SlowSqlEnableRequest {
    private String mode = "sleep";
    private long delayMs = 1000;
    private double injectRate = 1.0;
    private int durationSec = 0;
}
