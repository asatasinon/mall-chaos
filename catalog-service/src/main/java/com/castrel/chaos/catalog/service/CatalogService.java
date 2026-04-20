package com.castrel.chaos.catalog.service;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.catalog.entity.Product;
import com.castrel.chaos.catalog.repository.ProductRepository;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class CatalogService {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

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
        enrichQueryIfNeeded(null);
        listCount.increment();
        Page<Product> products = (category != null && !category.isBlank())
                ? productRepository.findByCategory(category, PageRequest.of(page, size))
                : productRepository.findAll(PageRequest.of(page, size));
        return products.map(this::toDTO);
    }

    public ProductDTO getProduct(String sku) {
        enrichQueryIfNeeded(sku);
        singleCount.increment();
        ProductDTO result = productRepository.findBySku(sku)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("PRODUCT_NOT_FOUND", "Product not found: " + sku));
        localQueryCacheManager.cacheIfNeeded("product:" + sku, result);
        return result;
    }

    public List<ProductDTO> batchQuery(List<String> skus) {
        enrichQueryIfNeeded(skus.isEmpty() ? null : skus.get(0));
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

    private void enrichQueryIfNeeded(String sku) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        if ("product_price_history".equals(joinTable) && sku != null) {
            jdbcTemplate.queryForList(
                    "SELECT p.* FROM products p" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = p.sku" +
                    " WHERE p.sku = ?" +
                    " AND p.status = 1" +
                    " AND pph.effective_at <= NOW()" +
                    " ORDER BY pph.effective_at DESC LIMIT 1", sku);
        } else if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT p.* FROM products p" +
                    " JOIN user_behavior_log ubl ON ubl.action_type = 'VIEW_PRODUCT'" +
                    " WHERE p.status = 1" +
                    " ORDER BY ubl.created_at DESC LIMIT 1");
        }
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

