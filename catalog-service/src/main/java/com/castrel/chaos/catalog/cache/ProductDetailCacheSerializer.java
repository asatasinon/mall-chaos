package com.castrel.chaos.catalog.cache;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

@Component
public class ProductDetailCacheSerializer {

    public static final int SCHEMA_VERSION = 1;

    private final ObjectMapper objectMapper;

    public ProductDetailCacheSerializer(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String serialize(String sku, ProductDTO product, Instant cachedAt, Instant expiresAt) {
        return serialize(sku, product, cachedAt, expiresAt, null);
    }

    public String serialize(String sku, ProductDTO product, Instant cachedAt, Instant expiresAt,
                            Integer targetSizeBytes) {
        if (sku == null || sku.isBlank() || product == null || cachedAt == null || expiresAt == null) {
            throw new IllegalArgumentException("Cache envelope fields are required");
        }
        if (!sku.equals(product.getSku())) {
            throw new IllegalArgumentException("Cache envelope SKU does not match product");
        }
        if (!expiresAt.isAfter(cachedAt)) {
            throw new IllegalArgumentException("Cache envelope expiration must be in the future");
        }

        ProductDetailCacheEnvelope envelope = new ProductDetailCacheEnvelope();
        envelope.setSchemaVersion(SCHEMA_VERSION);
        envelope.setSku(sku);
        envelope.setCachedAt(cachedAt.toString());
        envelope.setExpiresAt(expiresAt.toString());
        envelope.setProduct(product);

        if (targetSizeBytes == null) return write(envelope);
        if (targetSizeBytes <= 0) throw new IllegalArgumentException("Target cache size must be positive");

        envelope.setPadding("");
        int baseSize = utf8Length(write(envelope));
        if (baseSize > targetSizeBytes) {
            throw new IllegalArgumentException("Target cache size is smaller than the cache envelope");
        }
        envelope.setPadding("x".repeat(targetSizeBytes - baseSize));
        String serialized = write(envelope);
        if (utf8Length(serialized) != targetSizeBytes) {
            throw new IllegalStateException("Cache envelope padding did not reach the target size");
        }
        return serialized;
    }

    public DecodeResult deserialize(String fieldSku, String serialized, Instant now) {
        if (fieldSku == null || fieldSku.isBlank() || serialized == null || now == null) {
            return DecodeResult.invalid();
        }
        try {
            ProductDetailCacheEnvelope envelope = objectMapper.readValue(serialized, ProductDetailCacheEnvelope.class);
            if (envelope.getSchemaVersion() != SCHEMA_VERSION
                    || !fieldSku.equals(envelope.getSku())
                    || envelope.getProduct() == null
                    || !fieldSku.equals(envelope.getProduct().getSku())
                    || envelope.getCachedAt() == null
                    || envelope.getExpiresAt() == null) {
                return DecodeResult.invalid();
            }
            Instant cachedAt = Instant.parse(envelope.getCachedAt());
            Instant expiresAt = Instant.parse(envelope.getExpiresAt());
            if (expiresAt.isAfter(now) && !cachedAt.isAfter(now)) {
                return DecodeResult.valid(envelope.getProduct());
            }
            return DecodeResult.expired();
        } catch (JsonProcessingException | RuntimeException exception) {
            return DecodeResult.invalid();
        }
    }

    public int utf8Length(String serialized) {
        return serialized.getBytes(StandardCharsets.UTF_8).length;
    }

    private String write(ProductDetailCacheEnvelope envelope) {
        try {
            return objectMapper.writeValueAsString(envelope);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to serialize product detail cache", exception);
        }
    }

    public enum DecodeStatus {
        VALID,
        EXPIRED,
        INVALID
    }

    public record DecodeResult(DecodeStatus status, ProductDTO product) {
        static DecodeResult valid(ProductDTO product) {
            return new DecodeResult(DecodeStatus.VALID, product);
        }

        static DecodeResult expired() {
            return new DecodeResult(DecodeStatus.EXPIRED, null);
        }

        static DecodeResult invalid() {
            return new DecodeResult(DecodeStatus.INVALID, null);
        }
    }
}