package com.castrel.chaos.gateway.dto;

import java.util.List;

public record SlowSqlDispatchRequest(
        List<String> targets,
        String mode,
        int delayMs,
        double injectRate,
        String scope,
        int durationSec) {}
