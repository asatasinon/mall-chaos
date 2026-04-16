package com.castrel.chaos.notification.dto;

import lombok.Data;

@Data
public class SlowSqlEnableRequest {
    private String mode = "sleep";
    private long delayMs = 1000;
    private double injectRate = 1.0;
    private String scope = "ALL";
    private int durationSec = 0;
}
