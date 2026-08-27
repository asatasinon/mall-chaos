package com.castrel.chaos.catalog.service;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.catalog.dto.ProductBrowseReportDTO;
import com.castrel.chaos.catalog.entity.Product;
import com.castrel.chaos.catalog.repository.ProductRepository;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class CatalogService {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

    @Value("${reports.optimized:false}")
    private boolean optimizedReports;

    @Autowired
    private CatalogDependencyState dependencyState;

    private Counter listCount;
    private Counter singleCount;
    private Counter batchCount;

    @PostConstruct
    void initMetrics() {
        listCount = Counter.builder("catalog.query.count").tag("type", "list").register(meterRegistry);
        singleCount = Counter.builder("catalog.query.count").tag("type", "single").register(meterRegistry);
        batchCount = Counter.builder("catalog.query.count").tag("type", "batch").register(meterRegistry);
    }

    public Page<ProductDTO> listProducts(String category, String keyword, String sort, int page, int size) {
        listCount.increment();
        String sortProperty = switch (sort == null ? "latest" : sort) {
            case "price_asc", "price" -> "price";
            case "name" -> "name";
            default -> "id";
        };
        Sort.Direction direction = "price_desc".equals(sort) ? Sort.Direction.DESC : Sort.Direction.ASC;
        if ("latest".equals(sort) || sort == null) direction = Sort.Direction.DESC;
        PageRequest pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100),
                Sort.by(direction, sortProperty));
        Page<Product> products = (category != null && !category.isBlank())
                ? (keyword != null && !keyword.isBlank()
                    ? productRepository.findByCategoryAndNameContainingIgnoreCase(category, keyword, pageable)
                    : productRepository.findByCategory(category, pageable))
                : (keyword != null && !keyword.isBlank()
                    ? productRepository.findByNameContainingIgnoreCase(keyword, pageable)
                    : productRepository.findAll(pageable));
        return products.map(this::toDTO);
    }

    public ProductDTO getProduct(String sku) {
        singleCount.increment();
        ProductDTO result = productRepository.findBySku(sku)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("PRODUCT_NOT_FOUND", "Product not found: " + sku));
        localQueryCacheManager.cacheIfNeeded("product:" + sku, result);
        return result;
    }

    public ProductDTO validateListedProduct(String sku) {
        if (sku == null || sku.isBlank()) throw new BizException("PRODUCT_NOT_FOUND", "SKU is required");
        ProductDTO product = productRepository.findBySku(sku.trim())
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("PRODUCT_NOT_FOUND", "Product not found: " + sku));
        if (!Integer.valueOf(1).equals(product.getStatus())) {
            throw new BizException("PRODUCT_UNAVAILABLE", "Product is not listed: " + sku);
        }
        if (dependencyState != null && dependencyState.isUnavailable()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "Catalog dependency unavailable");
        }
        return product;
    }

    public List<ProductDTO> batchQuery(List<String> skus) {
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

    public List<ProductBrowseReportDTO> browseReportBaseline() {
        return jdbcTemplate.query(
                "SELECT p.sku, p.name, p.category, p.price, COUNT(ubl.id) AS browse_count, "
                        + "MAX(ubl.created_at) AS latest_browse_at "
                        + "FROM products p "
                        + "JOIN user_behavior_log ubl ON ubl.target_id = p.sku "
                        + "AND ubl.action_type = 'PAGE_VIEW' "
                        + "AND ubl.target_type = 'PRODUCT' "
                        + "WHERE p.status = 1 "
                        + "GROUP BY p.id, p.sku, p.name, p.category, p.price "
                        + "ORDER BY browse_count DESC, latest_browse_at DESC, p.id DESC",
                (rs, rowNum) -> {
                    ProductBrowseReportDTO report = new ProductBrowseReportDTO();
                    report.setSku(rs.getString("sku"));
                    report.setName(rs.getString("name"));
                    report.setCategory(rs.getString("category"));
                    report.setPrice(rs.getBigDecimal("price"));
                    report.setBrowseCount(rs.getLong("browse_count"));
                    report.setLatestBrowseAt(rs.getTimestamp("latest_browse_at").toLocalDateTime());
                    return report;
                });
    }

    public List<ProductBrowseReportDTO> browseReport() {
        return optimizedReports ? browseReportOptimized() : browseReportBaseline();
    }

    private List<ProductBrowseReportDTO> browseReportOptimized() {
        return jdbcTemplate.query(
                "SELECT p.sku, p.name, p.category, p.price, COUNT(ubl.id) AS browse_count, "
                        + "MAX(ubl.created_at) AS latest_browse_at "
                        + "FROM products p "
                        + "JOIN user_behavior_log ubl ON ubl.target_id = p.sku "
                        + "AND ubl.action_type = 'PAGE_VIEW' "
                        + "AND ubl.target_type = 'PRODUCT' "
                        + "AND ubl.created_at >= CURRENT_DATE "
                        + "AND ubl.created_at < CURRENT_DATE + INTERVAL 1 DAY "
                        + "WHERE p.status = 1 "
                        + "GROUP BY p.id, p.sku, p.name, p.category, p.price "
                        + "ORDER BY browse_count DESC, latest_browse_at DESC, p.id DESC",
                (rs, rowNum) -> {
                    ProductBrowseReportDTO report = new ProductBrowseReportDTO();
                    report.setSku(rs.getString("sku"));
                    report.setName(rs.getString("name"));
                    report.setCategory(rs.getString("category"));
                    report.setPrice(rs.getBigDecimal("price"));
                    report.setBrowseCount(rs.getLong("browse_count"));
                    report.setLatestBrowseAt(rs.getTimestamp("latest_browse_at").toLocalDateTime());
                    return report;
                });
    }

    private ProductDTO toDTO(Product p) {
        ProductDTO dto = new ProductDTO();
        dto.setId(p.getId());
        dto.setSku(p.getSku());
        dto.setName(p.getName());
        dto.setPrice(p.getPrice());
        dto.setStatus(p.getStatus());
        dto.setCategory(p.getCategory());
        dto.setMediaUrl(p.getMediaUrl());
        try {
            Integer available = jdbcTemplate.queryForObject(
                    "SELECT available_qty FROM inventories WHERE sku = ?", Integer.class, p.getSku());
            dto.setAvailableQty(available == null ? 0 : available);
        } catch (Exception ignored) {
            dto.setAvailableQty(0);
        }
        return dto;
    }
}
