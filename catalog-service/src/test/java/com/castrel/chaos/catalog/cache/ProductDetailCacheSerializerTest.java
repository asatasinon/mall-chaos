package com.castrel.chaos.catalog.cache;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProductDetailCacheSerializerTest {

    private ProductDetailCacheSerializer serializer;
    private ProductDTO product;
    private Instant cachedAt;
    private Instant expiresAt;

    @BeforeEach
    void setUp() {
        serializer = new ProductDetailCacheSerializer(new ObjectMapper());
        product = product("SKU-001");
        cachedAt = Instant.parse("2026-09-02T03:00:00Z");
        expiresAt = cachedAt.plusSeconds(300);
    }

    @Test
    void roundTripsProductAndReachesExactUtf8TargetSize() {
        String base = serializer.serialize("SKU-001", product, cachedAt, expiresAt);
        int targetSize = serializer.utf8Length(base) + 128;

        String padded = serializer.serialize("SKU-001", product, cachedAt, expiresAt, targetSize);
        ProductDetailCacheSerializer.DecodeResult decoded = serializer.deserialize(
                "SKU-001", padded, cachedAt.plusSeconds(1));

        assertThat(serializer.utf8Length(padded)).isEqualTo(targetSize);
        assertThat(decoded.status()).isEqualTo(ProductDetailCacheSerializer.DecodeStatus.VALID);
        assertThat(decoded.product()).usingRecursiveComparison().isEqualTo(product);
    }

    @Test
    void rejectsTargetSmallerThanEnvelope() {
        assertThatThrownBy(() -> serializer.serialize("SKU-001", product, cachedAt, expiresAt, 1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("smaller");
    }

    @Test
    void rejectsMismatchedFieldSkuAndSchema() {
        String payload = serializer.serialize("SKU-001", product, cachedAt, expiresAt);

        assertThat(serializer.deserialize("SKU-002", payload, cachedAt.plusSeconds(1)).status())
                .isEqualTo(ProductDetailCacheSerializer.DecodeStatus.INVALID);
        assertThat(serializer.deserialize("SKU-001", "{\"schemaVersion\":2}", cachedAt.plusSeconds(1)).status())
                .isEqualTo(ProductDetailCacheSerializer.DecodeStatus.INVALID);
    }

    @Test
    void rejectsExpiredAndMalformedValues() {
        String expired = serializer.serialize("SKU-001", product, cachedAt.minusSeconds(600), cachedAt.minusSeconds(1));

        assertThat(serializer.deserialize("SKU-001", expired, cachedAt).status())
                .isEqualTo(ProductDetailCacheSerializer.DecodeStatus.EXPIRED);
        assertThat(serializer.deserialize("SKU-001", "not-json", cachedAt).status())
                .isEqualTo(ProductDetailCacheSerializer.DecodeStatus.INVALID);
    }

    private ProductDTO product(String sku) {
        ProductDTO result = new ProductDTO();
        result.setId(1L);
        result.setSku(sku);
        result.setName("商品详情");
        result.setPrice(new BigDecimal("299.00"));
        result.setStatus(1);
        result.setCategory("Electronics");
        result.setMediaUrl(null);
        result.setAvailableQty(100);
        return result;
    }
}