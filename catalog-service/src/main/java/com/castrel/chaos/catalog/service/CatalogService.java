package com.castrel.chaos.catalog.service;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.catalog.entity.Product;
import com.castrel.chaos.catalog.repository.ProductRepository;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.chaos.SlowSqlChaosService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class CatalogService {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private SlowSqlChaosService slowSqlChaosService;

    @Autowired
    private MeterRegistry meterRegistry;

    private Counter listCount;
    private Counter singleCount;
    private Counter batchCount;

    @PostConstruct
    void initMetrics() {
        listCount = Counter.builder("catalog.query.count").tag("type", "list").register(meterRegistry);
        singleCount = Counter.builder("catalog.query.count").tag("type", "single").register(meterRegistry);
        batchCount = Counter.builder("catalog.query.count").tag("type", "batch").register(meterRegistry);
    }

    public Page<ProductDTO> listProducts(String category, int page, int size) {
        slowSqlChaosService.injectIfNeeded();
        listCount.increment();
        Page<Product> products = (category != null && !category.isBlank())
                ? productRepository.findByCategory(category, PageRequest.of(page, size))
                : productRepository.findAll(PageRequest.of(page, size));
        return products.map(this::toDTO);
    }

    public ProductDTO getProduct(String sku) {
        slowSqlChaosService.injectIfNeeded();
        singleCount.increment();
        return productRepository.findBySku(sku)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("PRODUCT_NOT_FOUND", "Product not found: " + sku));
    }

    public List<ProductDTO> batchQuery(List<String> skus) {
        slowSqlChaosService.injectIfNeeded();
        batchCount.increment();
        Map<String, ProductDTO> found = productRepository.findBySkuIn(skus)
                .stream()
                .collect(Collectors.toMap(Product::getSku, this::toDTO));
        return skus.stream().map(sku -> {
            if (found.containsKey(sku)) return found.get(sku);
            ProductDTO missing = new ProductDTO();
            missing.setSku(sku);
            missing.setStatus(-1); // not found sentinel
            return missing;
        }).collect(Collectors.toList());
    }

    private ProductDTO toDTO(Product p) {
        ProductDTO dto = new ProductDTO();
        dto.setId(p.getId());
        dto.setSku(p.getSku());
        dto.setName(p.getName());
        dto.setPrice(p.getPrice());
        dto.setStatus(p.getStatus());
        dto.setCategory(p.getCategory());
        return dto;
    }
}

