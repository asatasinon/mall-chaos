package com.castrel.chaos.catalog.cache;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProductDetailCacheServiceTest {

    private static final String DEFAULT_HASH = "catalog:product-detail:cache";
    private static final String MARKER_KEY = "catalog:product-detail:active";
    private static final String MARKER_OWNER_KEY = "catalog:product-detail:active:owner";
    private static final String MARKER_FENCE_KEY = "catalog:product-detail:active:fence";

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private HashOperations<String, Object, Object> hashOperations;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @Mock
    private ProductDetailCacheSerializer serializer;

    private ProductDetailCacheProperties properties;
    private ProductDetailCacheService cacheService;

    @BeforeEach
    void setUp() {
        properties = new ProductDetailCacheProperties();
        properties.setDefaultKey(DEFAULT_HASH);
        properties.setActiveMarkerKey(MARKER_KEY);
        lenient().when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        cacheService = new ProductDetailCacheService(
                redisTemplate, new ObjectMapper(), serializer, properties);
    }

    @Test
    void readsValidValueFromDefaultHashWhenNoMarkerExists() {
        ProductDTO product = product("SKU-001");
        when(valueOperations.get(MARKER_KEY)).thenReturn(null);
        when(hashOperations.get(DEFAULT_HASH, "SKU-001")).thenReturn("payload");
        when(serializer.deserialize(eq("SKU-001"), eq("payload"), any(Instant.class)))
                .thenReturn(new ProductDetailCacheSerializer.DecodeResult(
                        ProductDetailCacheSerializer.DecodeStatus.VALID, product));

        var result = cacheService.lookup("SKU-001");

        assertThat(result.status()).isEqualTo(ProductDetailCacheService.CacheStatus.HIT);
        assertThat(result.product()).isSameAs(product);
        assertThat(result.hashKey()).isEqualTo(DEFAULT_HASH);
    }

    @Test
    void usesValidMarkerHashAndReturnsMissForAnAbsentField() throws Exception {
        String runId = UUID.randomUUID().toString();
        String runHash = ProductDetailCacheService.RUN_HASH_PREFIX + runId;
        ProductDetailCacheMarker marker = new ProductDetailCacheMarker();
        marker.setSchemaVersion(ProductDetailCacheSerializer.SCHEMA_VERSION);
        marker.setRunId(runId);
        marker.setFencingToken(3);
        marker.setHashKey(runHash);
        marker.setProbeSku("SKU-050");
        marker.setExpiresAt(Instant.now().plusSeconds(60).toString());
        when(valueOperations.get(MARKER_KEY)).thenReturn(new ObjectMapper().writeValueAsString(marker));
        when(valueOperations.get(MARKER_OWNER_KEY)).thenReturn(runId);
        when(valueOperations.get(MARKER_FENCE_KEY)).thenReturn("3");
        when(hashOperations.get(runHash, "SKU-050")).thenReturn(null);

        var result = cacheService.lookup("SKU-050");

        assertThat(result.status()).isEqualTo(ProductDetailCacheService.CacheStatus.MISS);
        assertThat(result.hashKey()).isEqualTo(runHash);
        verify(hashOperations).get(runHash, "SKU-050");
        verify(hashOperations, never()).get(DEFAULT_HASH, "SKU-050");
    }

    @Test
    void fallsBackToDefaultHashWhenMarkerOwnerDoesNotMatch() throws Exception {
        String runId = UUID.randomUUID().toString();
        ProductDetailCacheMarker marker = new ProductDetailCacheMarker();
        marker.setSchemaVersion(ProductDetailCacheSerializer.SCHEMA_VERSION);
        marker.setRunId(runId);
        marker.setFencingToken(3);
        marker.setHashKey(ProductDetailCacheService.RUN_HASH_PREFIX + runId);
        marker.setProbeSku("SKU-050");
        marker.setExpiresAt(Instant.now().plusSeconds(60).toString());
        when(valueOperations.get(MARKER_KEY)).thenReturn(new ObjectMapper().writeValueAsString(marker));
        when(valueOperations.get(MARKER_OWNER_KEY)).thenReturn("another-run");
        when(valueOperations.get(MARKER_FENCE_KEY)).thenReturn("3");
        when(hashOperations.get(DEFAULT_HASH, "SKU-050")).thenReturn(null);

        var result = cacheService.lookup("SKU-050");

        assertThat(result.status()).isEqualTo(ProductDetailCacheService.CacheStatus.MISS);
        assertThat(result.hashKey()).isEqualTo(DEFAULT_HASH);
        verify(hashOperations).get(DEFAULT_HASH, "SKU-050");
    }

    @Test
    void fallsBackToDefaultHashWhenMarkerHasExpired() throws Exception {
        String runId = UUID.randomUUID().toString();
        ProductDetailCacheMarker marker = new ProductDetailCacheMarker();
        marker.setSchemaVersion(ProductDetailCacheSerializer.SCHEMA_VERSION);
        marker.setRunId(runId);
        marker.setFencingToken(3);
        marker.setHashKey(ProductDetailCacheService.RUN_HASH_PREFIX + runId);
        marker.setProbeSku("SKU-050");
        marker.setExpiresAt(Instant.now().minusSeconds(1).toString());
        when(valueOperations.get(MARKER_KEY)).thenReturn(new ObjectMapper().writeValueAsString(marker));
        when(valueOperations.get(MARKER_OWNER_KEY)).thenReturn(runId);
        when(valueOperations.get(MARKER_FENCE_KEY)).thenReturn("3");
        when(hashOperations.get(DEFAULT_HASH, "SKU-050")).thenReturn(null);

        var result = cacheService.lookup("SKU-050");

        assertThat(result.status()).isEqualTo(ProductDetailCacheService.CacheStatus.MISS);
        assertThat(result.hashKey()).isEqualTo(DEFAULT_HASH);
        verify(hashOperations).get(DEFAULT_HASH, "SKU-050");
        verify(hashOperations, never()).get(ProductDetailCacheService.RUN_HASH_PREFIX + runId, "SKU-050");
    }

    @Test
    void invalidatesMalformedValueAndRemovesOnlyThatField() {
        when(valueOperations.get(MARKER_KEY)).thenReturn(null);
        when(hashOperations.get(DEFAULT_HASH, "SKU-001")).thenReturn("malformed");
        when(serializer.deserialize(eq("SKU-001"), eq("malformed"), any(Instant.class)))
                .thenReturn(new ProductDetailCacheSerializer.DecodeResult(
                        ProductDetailCacheSerializer.DecodeStatus.INVALID, null));

        var result = cacheService.lookup("SKU-001");

        assertThat(result.status()).isEqualTo(ProductDetailCacheService.CacheStatus.INVALID);
        verify(hashOperations).delete(DEFAULT_HASH, "SKU-001");
    }

    @Test
    void treatsRedisFailureAsBackendError() {
        when(valueOperations.get(MARKER_KEY)).thenThrow(new IllegalStateException("Redis unavailable"));

        var result = cacheService.lookup("SKU-001");

        assertThat(result.status()).isEqualTo(ProductDetailCacheService.CacheStatus.BACKEND_ERROR);
        assertThat(result.hashKey()).isNull();
    }

    @Test
    void storesWithLogicalTtlAndSkipsWritesAfterBackendFailure() {
        ProductDTO product = product("SKU-001");
        when(serializer.serialize(eq("SKU-001"), eq(product), any(Instant.class), any(Instant.class)))
                .thenReturn("serialized");
        var lookup = new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.MISS, null, DEFAULT_HASH);

        assertThat(cacheService.store(lookup, product))
                .isEqualTo(ProductDetailCacheService.CacheWriteStatus.STORED);
        verify(hashOperations).put(DEFAULT_HASH, "SKU-001", "serialized");

        var backendError = new ProductDetailCacheService.CacheLookup(
                ProductDetailCacheService.CacheStatus.BACKEND_ERROR, null, null);
        assertThat(cacheService.store(backendError, product))
                .isEqualTo(ProductDetailCacheService.CacheWriteStatus.SKIPPED);
    }

        @Test
        void restoresFallbackTtlWhenADeletedRunHashIsRecreated() {
        ProductDTO product = product("SKU-001");
        String runHash = ProductDetailCacheService.RUN_HASH_PREFIX + "123e4567-e89b-12d3-a456-426614174000";
        when(serializer.serialize(eq("SKU-001"), eq(product), any(Instant.class), any(Instant.class)))
            .thenReturn("serialized");
        when(redisTemplate.getExpire(runHash, TimeUnit.SECONDS)).thenReturn(-2L);
        when(redisTemplate.expire(eq(runHash), any(Duration.class))).thenReturn(true);
        var lookup = new ProductDetailCacheService.CacheLookup(
            ProductDetailCacheService.CacheStatus.MISS, null, runHash);

        assertThat(cacheService.store(lookup, product))
            .isEqualTo(ProductDetailCacheService.CacheWriteStatus.STORED);
        verify(redisTemplate).expire(eq(runHash), any(Duration.class));
        }

    private ProductDTO product(String sku) {
        ProductDTO result = new ProductDTO();
        result.setId(1L);
        result.setSku(sku);
        result.setName("Product");
        result.setPrice(new BigDecimal("10.00"));
        result.setStatus(1);
        result.setAvailableQty(10);
        return result;
    }
}