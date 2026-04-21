package com.castrel.chaos.gateway.dto;

import java.util.List;

public record DeadlockDispatchRequest(
        List<String> targets,
        double injectRate,
        String scope,
        int durationSec) {}
