package com.castrel.chaos.inventory.dto;

import lombok.Data;

import java.util.List;

@Data
public class ResetRequest {
    private int expectedVersion;
    private Object scope = "ALL"; // "ALL" or List<String> of SKUs
}
