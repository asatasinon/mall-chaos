package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.dto.BatchQueryRequest;
import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.catalog.dto.ProductBrowseReportDTO;
import com.castrel.chaos.catalog.service.CatalogService;
import com.castrel.chaos.common.ApiResponse;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.List;

@RestController
public class CatalogController {

    @Autowired
    private CatalogService catalogService;

    @GetMapping("/api/products")
    public ApiResponse<Page<ProductDTO>> listProducts(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "latest") String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ApiResponse.ok(catalogService.listProducts(category, keyword, sort, page, size));
    }

    @GetMapping("/api/products/{sku}")
    public ApiResponse<ProductDTO> getProduct(@PathVariable String sku, HttpServletResponse response) {
        CatalogService.ProductDetailResult result = catalogService.getProductDetail(sku);
        response.setHeader("X-Castrel-Cache-Result", result.cacheResult());
        return ApiResponse.ok(result.product());
    }

    @GetMapping("/internal/catalog/products/{sku}/validate")
    public ApiResponse<ProductDTO> validateProduct(@PathVariable String sku) {
        return ApiResponse.ok(catalogService.validateListedProduct(sku));
    }

    @GetMapping("/api/reports/product-browse")
    public ApiResponse<List<ProductBrowseReportDTO>> browseReport() {
        return ApiResponse.ok(catalogService.browseReport());
    }

    @PostMapping("/internal/catalog/batch")
    public ApiResponse<Map<String, List<ProductDTO>>> batchQuery(@RequestBody BatchQueryRequest req) {
        List<ProductDTO> products = catalogService.batchQuery(req.getSkus());
        return ApiResponse.ok(Map.of("products", products));
    }
}
