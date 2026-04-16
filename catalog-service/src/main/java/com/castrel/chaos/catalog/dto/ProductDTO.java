package com.castrel.chaos.catalog.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class ProductDTO {
    private Long id;
    private String sku;
    private String name;
    private BigDecimal price;
    private Integer status;
    private String category;
}
