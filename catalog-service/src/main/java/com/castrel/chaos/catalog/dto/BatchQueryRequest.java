package com.castrel.chaos.catalog.dto;

import lombok.Data;

import java.util.List;

@Data
public class BatchQueryRequest {
    private List<String> skus;
}
