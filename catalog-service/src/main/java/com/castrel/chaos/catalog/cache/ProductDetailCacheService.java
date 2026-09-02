package com.castrel.chaos.catalog.cache;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Service
public class ProductDetailCacheService {

    public static final String RUN_HASH_PREFIX = "catalog:product-detail:exercise:";

    private static final Logger log = LoggerFactory.getLogger(ProductDetailCacheService.class);

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final ProductDetailCacheSerializer serializer;
    private final ProductDetailCacheProperties properties;

    public ProductDetailCacheService(StringRedisTemplate redisTemplate,
                                     ObjectMapper objectMapper,
                                     ProductDetailCacheSerializer serializer,
                                     ProductDetailCacheProperties properties) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.serializer = serializer;
        this.properties = properties;
    }

    public CacheLookup lookup(String sku) {
        Instant now = Instant.now();
        try {
            String hashKey = resolveHashKey(now);
            Object rawPayload = redisTemplate.opsForHash().get(hashKey, sku);
            String payload = rawPayload == null ? null : String.valueOf(rawPayload);
            if (payload == null) return CacheLookup.miss(hashKey);

            ProductDetailCacheSerializer.DecodeResult decoded = serializer.deserialize(sku, payload, now);
            if (decoded.status() == ProductDetailCacheSerializer.DecodeStatus.VALID) {
                return CacheLookup.hit(hashKey, decoded.product());
            }
            try {
                redisTemplate.opsForHash().delete(hashKey, sku);
            } catch (RuntimeException exception) {
                log.debug("Unable to remove invalid product detail cache value", exception);
                return CacheLookup.backendError();
            }
            return CacheLookup.invalid(hashKey);
        } catch (RuntimeException exception) {
            log.debug("Product detail cache lookup failed", exception);
            return CacheLookup.backendError();
        }
    }

    public CacheWriteStatus store(CacheLookup lookup, ProductDTO product) {
        if (lookup == null || lookup.hashKey() == null || lookup.status() == CacheStatus.BACKEND_ERROR) {
            return CacheWriteStatus.SKIPPED;
        }
        Instant cachedAt = Instant.now();
        Duration logicalTtl = properties.getLogicalTtl();
        if (logicalTtl == null || logicalTtl.isNegative() || logicalTtl.isZero()) {
            return CacheWriteStatus.FAILED;
        }
        try {
            String payload = serializer.serialize(product.getSku(), product, cachedAt, cachedAt.plus(logicalTtl));
            redisTemplate.opsForHash().put(lookup.hashKey(), product.getSku(), payload);
            return CacheWriteStatus.STORED;
        } catch (RuntimeException exception) {
            log.debug("Product detail cache write failed", exception);
            return CacheWriteStatus.FAILED;
        }
    }

    private String resolveHashKey(Instant now) {
        String markerPayload = redisTemplate.opsForValue().get(activeMarkerKey());
        if (markerPayload == null || markerPayload.isBlank()) return defaultHashKey();
        try {
            ProductDetailCacheMarker marker = objectMapper.readValue(markerPayload, ProductDetailCacheMarker.class);
            if (isValidMarker(marker, now)) return marker.getHashKey();
            return defaultHashKey();
        } catch (JsonProcessingException | RuntimeException exception) {
            log.debug("Ignoring invalid product detail cache marker", exception);
            return defaultHashKey();
        }
    }

    private boolean isValidMarker(ProductDetailCacheMarker marker, Instant now) {
        if (marker == null || marker.getSchemaVersion() != ProductDetailCacheSerializer.SCHEMA_VERSION
                || marker.getFencingToken() <= 0 || marker.getProbeSku() == null
                || marker.getProbeSku().isBlank() || marker.getExpiresAt() == null) return false;
        try {
            UUID.fromString(marker.getFaultRunId());
            Instant expiresAt = Instant.parse(marker.getExpiresAt());
            return expiresAt.isAfter(now)
                    && (RUN_HASH_PREFIX + marker.getFaultRunId()).equals(marker.getHashKey());
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private String defaultHashKey() {
        return nonBlankOrDefault(properties.getDefaultKey(), "catalog:product-detail:cache");
    }

    private String activeMarkerKey() {
        return nonBlankOrDefault(properties.getActiveMarkerKey(), "catalog:product-detail:active");
    }

    private String nonBlankOrDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    public enum CacheStatus {
        HIT,
        MISS,
        INVALID,
        BACKEND_ERROR
    }

    public enum CacheWriteStatus {
        STORED,
        SKIPPED,
        FAILED
    }

    public record CacheLookup(CacheStatus status, ProductDTO product, String hashKey) {
        private static CacheLookup hit(String hashKey, ProductDTO product) {
            return new CacheLookup(CacheStatus.HIT, product, hashKey);
        }

        private static CacheLookup miss(String hashKey) {
            return new CacheLookup(CacheStatus.MISS, null, hashKey);
        }

        private static CacheLookup invalid(String hashKey) {
            return new CacheLookup(CacheStatus.INVALID, null, hashKey);
        }

        private static CacheLookup backendError() {
            return new CacheLookup(CacheStatus.BACKEND_ERROR, null, null);
        }
    }
}