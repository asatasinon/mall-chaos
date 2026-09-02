package com.castrel.chaos.catalog.service;

import com.castrel.chaos.catalog.cache.ProductDetailCacheService;
import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.catalog.entity.Product;
import com.castrel.chaos.catalog.repository.ProductRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CatalogServiceProductDetailCacheTest {

    @Mock
    private ProductRepository productRepository;

    @Mock
    private ProductDetailCacheService cacheService;

    @Mock
    private JdbcTemplate jdbcTemplate;

    private CatalogService catalogService;

    @BeforeEach
    void setUp() {
        catalogService = new CatalogService(
                productRepository,
                cacheService,
                jdbcTemplate,
                new SimpleMeterRegistry(),
                new CatalogDependencyState());
        catalogService.initMetrics();
    }

    @Test
    void returnsCacheHitWithoutQueryingProductDatabase() {
        ProductDTO cached = dto("SKU-001");
        when(cacheService.lookup("SKU-001")).thenReturn(new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.HIT, cached, "catalog:product-detail:cache"));

        assertThat(catalogService.getProductDetail(" SKU-001 ").product()).isSameAs(cached);
        assertThat(catalogService.getProductDetail("SKU-001").cacheResult()).isEqualTo("CACHE_HIT");

        verify(productRepository, never()).findBySku(any());
        verify(cacheService, never()).store(any(), any());
    }

    @Test
    void fallsBackToDatabaseAndRefillsCacheOnMiss() {
        Product product = product("SKU-001");
        ProductDTO expected = dto("SKU-001");
        when(cacheService.lookup("SKU-001")).thenReturn(new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.MISS, null, "catalog:product-detail:cache"));
        when(productRepository.findBySku("SKU-001")).thenReturn(Optional.of(product));
        when(jdbcTemplate.query(any(PreparedStatementCreator.class), any(ResultSetExtractor.class)))
                .thenReturn(expected.getAvailableQty());
        when(cacheService.store(any(), any())).thenReturn(ProductDetailCacheService.CacheWriteStatus.STORED);

        ProductDTO result = catalogService.getProduct("SKU-001");

        assertThat(result.getSku()).isEqualTo(expected.getSku());
        assertThat(result.getAvailableQty()).isEqualTo(expected.getAvailableQty());
        verify(productRepository).findBySku("SKU-001");
        verify(cacheService).store(any(), any(ProductDTO.class));
    }

    @Test
    void returnsDatabaseResultWhenRedisWriteFails() {
        Product product = product("SKU-001");
        when(cacheService.lookup("SKU-001")).thenReturn(new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.MISS, null, "catalog:product-detail:cache"));
        when(productRepository.findBySku("SKU-001")).thenReturn(Optional.of(product));
        when(cacheService.store(any(), any())).thenReturn(ProductDetailCacheService.CacheWriteStatus.FAILED);

        assertThat(catalogService.getProduct("SKU-001").getSku()).isEqualTo("SKU-001");
        verify(productRepository).findBySku("SKU-001");
    }

    @Test
    void missesThenRefillsAndHitsWithoutQueryingProductDatabaseAgain() {
        Product product = product("SKU-001");
        ProductDTO expected = dto("SKU-001");
        when(cacheService.lookup("SKU-001")).thenReturn(
                new ProductDetailCacheService.CacheLookup(
                        ProductDetailCacheService.CacheStatus.MISS, null, "catalog:product-detail:cache"),
                new ProductDetailCacheService.CacheLookup(
                        ProductDetailCacheService.CacheStatus.HIT, expected, "catalog:product-detail:cache"));
        when(productRepository.findBySku("SKU-001")).thenReturn(Optional.of(product));
        when(jdbcTemplate.query(any(PreparedStatementCreator.class), any(ResultSetExtractor.class)))
                .thenReturn(expected.getAvailableQty());
        when(cacheService.store(any(), any())).thenReturn(ProductDetailCacheService.CacheWriteStatus.STORED);

        assertThat(catalogService.getProductDetail("SKU-001").cacheResult())
                .isEqualTo("CACHE_MISS_DB_FALLBACK");
        assertThat(catalogService.getProductDetail("SKU-001").cacheResult())
                .isEqualTo("CACHE_HIT");

        verify(productRepository).findBySku("SKU-001");
        verify(cacheService).store(any(), eq(dto("SKU-001")));
    }

    @Test
    void mapsInvalidCacheFallbackToStableResult() {
        Product product = product("SKU-001");
        when(cacheService.lookup("SKU-001")).thenReturn(new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.INVALID, null, "catalog:product-detail:cache"));
        when(productRepository.findBySku("SKU-001")).thenReturn(Optional.of(product));
        when(cacheService.store(any(), any())).thenReturn(ProductDetailCacheService.CacheWriteStatus.STORED);

        assertThat(catalogService.getProductDetail("SKU-001").cacheResult())
                .isEqualTo("CACHE_INVALID_FALLBACK");
        verify(productRepository).findBySku("SKU-001");
        verify(cacheService).store(any(), any(ProductDTO.class));
    }

    @Test
    void mapsCacheBackendFailureWithoutAttemptingCacheWrite() {
        Product product = product("SKU-001");
        when(cacheService.lookup("SKU-001")).thenReturn(new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.BACKEND_ERROR, null, null));
        when(productRepository.findBySku("SKU-001")).thenReturn(Optional.of(product));

        assertThat(catalogService.getProductDetail("SKU-001").cacheResult())
                .isEqualTo("CACHE_BACKEND_ERROR");
        verify(productRepository).findBySku("SKU-001");
        verify(cacheService).store(any(), any(ProductDTO.class));
    }

    @Test
    void mapsMissingProductWithoutWritingAPlaceholder() {
        when(cacheService.lookup("SKU-404")).thenReturn(new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.MISS, null, "catalog:product-detail:cache"));
        when(productRepository.findBySku("SKU-404")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> catalogService.getProductDetail("SKU-404"))
                .isInstanceOf(com.castrel.chaos.common.BizException.class)
                .extracting("errorCode")
                .isEqualTo("PRODUCT_NOT_FOUND");
        verify(cacheService, never()).store(any(), any());
        }

    @Test
    void mapsDatabaseTimeoutToStableProductDetailError() {
        when(cacheService.lookup("SKU-001")).thenReturn(new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.MISS, null, "catalog:product-detail:cache"));
        when(productRepository.findBySku("SKU-001")).thenThrow(new QueryTimeoutException("database timeout"));

        assertThatThrownBy(() -> catalogService.getProduct("SKU-001"))
                .isInstanceOf(com.castrel.chaos.common.BizException.class)
                .extracting("errorCode")
                .isEqualTo("PRODUCT_DETAIL_TIMEOUT");
        verify(cacheService, never()).store(any(), any());
    }

    private Product product(String sku) {
        Product result = new Product();
        result.setId(1L);
        result.setSku(sku);
        result.setName("Product");
        result.setPrice(new BigDecimal("10.00"));
        result.setStatus(1);
        result.setCategory("Electronics");
        return result;
    }

    private ProductDTO dto(String sku) {
        ProductDTO result = new ProductDTO();
        result.setId(1L);
        result.setSku(sku);
        result.setName("Product");
        result.setPrice(new BigDecimal("10.00"));
        result.setStatus(1);
        result.setCategory("Electronics");
        result.setAvailableQty(10);
        return result;
    }
}