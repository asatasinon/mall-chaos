package com.castrel.chaos.gateway.dto;

public record NetworkFaultRequest(
        String proxyName,
        int latencyMs,
        int jitter) {}
