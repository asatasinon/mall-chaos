package com.castrel.chaos.gateway.dto;

public record InventoryResetDispatchRequest(
        int expectedVersion,
        Object scope
) {}
