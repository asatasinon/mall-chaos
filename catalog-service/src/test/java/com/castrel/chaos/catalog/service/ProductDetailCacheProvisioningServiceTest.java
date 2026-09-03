package com.castrel.chaos.catalog.service;

import com.castrel.chaos.catalog.cache.ProductDetailCacheMarker;
import com.castrel.chaos.catalog.cache.ProductDetailCacheProperties;
import com.castrel.chaos.catalog.cache.ProductDetailCacheSerializer;
import com.castrel.chaos.catalog.cache.ProductDetailCacheService;
import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProductDetailCacheProvisioningServiceTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private static final String RUN_HASH = ProductDetailCacheService.RUN_HASH_PREFIX + RUN_ID;
    private static final String TEMP_HASH = RUN_HASH + ":tmp:7";
    private static final String MARKER_KEY = "catalog:product-detail:active";
    private static final String OWNER_KEY = "catalog:product-detail:active:owner";
    private static final String FENCE_KEY = "catalog:product-detail:active:fence";

    @Mock
    private CatalogService catalogService;

    @Mock
    private ProductDetailCacheService cacheService;

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private HashOperations<String, Object, Object> hashOperations;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @Mock
        private OperationRunGuard runGuard;

    private ProductDetailCacheSerializer serializer;
    private ProductDetailCacheProperties properties;
    private ProductDetailCacheProvisioningService provisioningService;

    @BeforeEach
    void setUp() {
        serializer = new ProductDetailCacheSerializer(new ObjectMapper());
        properties = new ProductDetailCacheProperties();
        properties.setActiveMarkerKey(MARKER_KEY);
        properties.setActiveMarkerOwnerKey(OWNER_KEY);
        properties.setActiveMarkerFenceKey(FENCE_KEY);
        properties.setMaxMemberCount(47);
        properties.setMaxMemberSizeBytes(128 * 1024 * 1024);
        properties.setMaxLogicalBytes(512L * 1024 * 1024);
        properties.setCleanupGraceSeconds(60);

        lenient().when(cacheService.runHashKey(RUN_ID)).thenReturn(RUN_HASH);
        lenient().when(cacheService.activeMarkerKey()).thenReturn(MARKER_KEY);
        lenient().when(cacheService.activeMarkerOwnerKey()).thenReturn(OWNER_KEY);
        lenient().when(cacheService.activeMarkerFenceKey()).thenReturn(FENCE_KEY);
        lenient().when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        lenient().when(redisTemplate.expire(anyString(), any(Duration.class))).thenReturn(true);
        lenient().when(hashOperations.size(anyString())).thenReturn(2L);
        lenient().when(runGuard.acceptStart(any())).thenReturn(true);

        provisioningService = new ProductDetailCacheProvisioningService(
                catalogService, cacheService, serializer, properties,
                redisTemplate, new ObjectMapper(), runGuard);
    }

    @Test
    void provisionsSortedMembersWithAnExcludedProbeAndExactLogicalBytes() {
        when(catalogService.listSellableProducts()).thenReturn(List.of(
                product("SKU-003"), product("SKU-001"), product("SKU-002")));
        when(redisTemplate.execute(any(org.springframework.data.redis.core.script.DefaultRedisScript.class),
                anyList(), any(Object[].class))).thenReturn(1L);

        Map<String, Object> summary = provisioningService.start(context(), parameters(2, 1024));

        assertThat(summary)
                .containsEntry("layout", "HASH")
                .containsEntry("memberCount", 2)
                .containsEntry("memberSizeBytes", 1024)
                .containsEntry("logicalBytes", 2048L)
                .containsEntry("probeSku", "SKU-003")
                .containsEntry("hashKey", RUN_HASH);
        assertThat(summary.get("memberSkus")).isEqualTo(List.of("SKU-001", "SKU-002"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> fields = ArgumentCaptor.forClass(Map.class);
        verify(hashOperations).putAll(eq(TEMP_HASH), fields.capture());
        assertThat(fields.getValue()).containsOnlyKeys("SKU-001", "SKU-002");
        assertThat(fields.getValue().values())
                .allSatisfy(value -> assertThat(serializer.utf8Length(value)).isEqualTo(1024));
        verify(redisTemplate).rename(TEMP_HASH, RUN_HASH);
        verify(runGuard).registerCleanup(any(), any(Runnable.class));
    }

    @Test
    void rejectsARequestThatCannotLeaveAProbeSku() {
        when(catalogService.listSellableProducts()).thenReturn(List.of(product("SKU-001"), product("SKU-002")));

        assertThatThrownBy(() -> provisioningService.start(context(), parameters(2, 1024)))
                .isInstanceOf(BizException.class)
                .hasMessageContaining("probe SKU");

        verify(hashOperations, never()).putAll(anyString(), any());
    }

    @Test
    void rejectsAggregateLogicalBytesAboveTheServiceBudget() {
        properties.setMaxLogicalBytes(1024);

        assertThatThrownBy(() -> provisioningService.start(context(), parameters(2, 1024)))
                .isInstanceOf(BizException.class)
                .extracting("errorCode")
                .isEqualTo("AGGREGATE_LOGICAL_BYTES_EXCEEDS_LIMIT");

        verify(hashOperations, never()).putAll(anyString(), any());
    }

    @Test
    void rejectsMemberSizeThatCannotContainAProductDetailEnvelope() {
        when(catalogService.listSellableProducts()).thenReturn(List.of(
                product("SKU-001"), product("SKU-002")));

        assertThatThrownBy(() -> provisioningService.start(context(), parameters(1, 1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("smaller");

        verify(hashOperations, never()).putAll(anyString(), any());
    }

    @Test
    void rejectsTtlThatDoesNotCoverTheRunAndCleanupGrace() {
        Map<String, Object> shortTtl = new java.util.LinkedHashMap<>(parameters(1, 1024));
        shortTtl.put("durationSec", 30);
        shortTtl.put("keyTtlSec", 89);

        assertThatThrownBy(() -> provisioningService.start(context(), shortTtl))
                .isInstanceOf(BizException.class)
                .extracting("errorCode")
                .isEqualTo("KEY_TTL_TOO_SHORT");

        verify(hashOperations, never()).putAll(anyString(), any());
    }

    @Test
    void rollsBackTheRunHashWhenMarkerPublicationIsRejected() {
        when(catalogService.listSellableProducts()).thenReturn(List.of(
                product("SKU-001"), product("SKU-002"), product("SKU-003")));
        when(redisTemplate.execute(any(org.springframework.data.redis.core.script.DefaultRedisScript.class),
                anyList(), any(Object[].class))).thenReturn(0L);

        assertThatThrownBy(() -> provisioningService.start(context(), parameters(2, 1024)))
                .isInstanceOf(BizException.class)
                .hasMessageContaining("active marker");

        verify(redisTemplate, atLeastOnce()).delete(TEMP_HASH);
        verify(redisTemplate).delete(RUN_HASH);
    }

    @Test
    void refusesCleanupWhenAnotherRunOwnsTheMarker() {
        when(valueOperations.get(MARKER_KEY)).thenReturn("marker");
        when(valueOperations.get(OWNER_KEY)).thenReturn("another-run");
        when(valueOperations.get(FENCE_KEY)).thenReturn("8");

        assertThatThrownBy(() -> provisioningService.cleanup(context()))
                .isInstanceOf(BizException.class)
                .extracting("errorCode")
                .isEqualTo("STALE_OPERATION");

        verify(redisTemplate, never()).delete(RUN_HASH);
    }

        @Test
        void refusesCleanupWhenTheCurrentOwnerHasAStaleFence() {
                when(valueOperations.get(MARKER_KEY)).thenReturn("marker");
                when(valueOperations.get(OWNER_KEY)).thenReturn(RUN_ID);
                when(valueOperations.get(FENCE_KEY)).thenReturn("8");

                assertThatThrownBy(() -> provisioningService.cleanup(context()))
                                .isInstanceOf(BizException.class)
                                .extracting("errorCode")
                                .isEqualTo("STALE_OPERATION");

                verify(redisTemplate, never()).delete(RUN_HASH);
        }

    @Test
    void cleanupIsIdempotentWhenMarkerAlreadyDisappeared() {
        when(valueOperations.get(MARKER_KEY)).thenReturn(null);
        when(valueOperations.get(OWNER_KEY)).thenReturn(null);
        when(valueOperations.get(FENCE_KEY)).thenReturn(null);
        when(redisTemplate.execute(any(org.springframework.data.redis.core.script.DefaultRedisScript.class),
                anyList(), any(Object[].class))).thenReturn(0L);
        when(redisTemplate.delete(RUN_HASH)).thenReturn(true);

        Map<String, Object> result = provisioningService.cleanup(context());

        assertThat(result).containsEntry("released", true)
                .containsEntry("markerRemoved", false)
                .containsEntry("hashRemoved", true);
        verify(redisTemplate).delete(RUN_HASH);
    }

        private OperationRunContext context() {
                return new OperationRunContext(
                RUN_ID, Instant.now().plusSeconds(600), 7, "phase-d-test-001");
    }

    private Map<String, Object> parameters(int memberCount, int memberSizeBytes) {
        return Map.of(
                "durationSec", 30,
                "concurrency", 2,
                "requestIntervalMs", 100,
                "memberCount", memberCount,
                "memberSizeBytes", memberSizeBytes,
                "keyTtlSec", 900);
    }

    private ProductDTO product(String sku) {
        ProductDTO product = new ProductDTO();
        product.setId(Long.valueOf(sku.substring(4)));
        product.setSku(sku);
        product.setName("Product " + sku);
        product.setPrice(new BigDecimal("10.00"));
        product.setStatus(1);
        product.setCategory("Electronics");
        product.setAvailableQty(100);
        return product;
    }
}
