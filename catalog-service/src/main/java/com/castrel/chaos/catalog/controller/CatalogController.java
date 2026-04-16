package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.dto.BatchQueryRequest;
import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.catalog.service.CatalogService;
import com.castrel.chaos.common.ApiResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
public class CatalogController {

    @Autowired
    private CatalogService catalogService;

    @GetMapping("/api/products")
    public ApiResponse<Page<ProductDTO>> listProducts(
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ApiResponse.ok(catalogService.listProducts(category, page, size));
    }

    @GetMapping("/api/products/{sku}")
    public ApiResponse<ProductDTO> getProduct(@PathVariable String sku) {
        return ApiResponse.ok(catalogService.getProduct(sku));
    }

    @PostMapping("/internal/catalog/batch")
    public ApiResponse<Map<String, List<ProductDTO>>> batchQuery(@RequestBody BatchQueryRequest req) {
        List<ProductDTO> products = catalogService.batchQuery(req.getSkus());
        return ApiResponse.ok(Map.of("products", products));
    }
}
