package com.castrel.chaos.gateway.dto;

public record TableLockDispatchRequest(
        String targetService,
        String targetTable,
        int durationSec) {}
