package com.castrel.chaos.catalog.dto;

import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class ProductBrowseReportDTO {
    private String sku;
    private String name;
    private String category;
    private BigDecimal price;
    private Long browseCount;
    private LocalDateTime latestBrowseAt;
}
