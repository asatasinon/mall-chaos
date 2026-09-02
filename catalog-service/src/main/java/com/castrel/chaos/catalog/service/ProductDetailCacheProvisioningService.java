package com.castrel.chaos.catalog.service;

import com.castrel.chaos.catalog.cache.ProductDetailCacheMarker;
import com.castrel.chaos.catalog.cache.ProductDetailCacheProperties;
import com.castrel.chaos.catalog.cache.ProductDetailCacheSerializer;
import com.castrel.chaos.catalog.cache.ProductDetailCacheService;
import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class ProductDetailCacheProvisioningService {

    public static final String SCENARIO = "CATALOG_REDIS_LARGE_VALUE";
    public static final String OPERATION = "catalog-product-detail-large-value";

    private static final Set<String> ALLOWED_PARAMETERS = Set.of(
            "durationSec", "concurrency", "requestIntervalMs", "memberCount", "memberSizeBytes", "keyTtlSec");
    private static final DefaultRedisScript<Long> PUBLISH_MARKER_SCRIPT = new DefaultRedisScript<>(
            "local marker = redis.call('GET', KEYS[1]) "
                    + "local owner = redis.call('GET', KEYS[2]) "
                    + "local fence = redis.call('GET', KEYS[3]) "
                    + "if (marker and not owner) or (owner and not fence) then return 0 end "
                    + "if fence and tonumber(fence) > tonumber(ARGV[2]) then return 0 end "
                    + "redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3]) "
                    + "redis.call('SET', KEYS[2], ARGV[4], 'PX', ARGV[3]) "
                    + "redis.call('SET', KEYS[3], ARGV[2], 'PX', ARGV[3]) return 1",
            Long.class);
    private static final DefaultRedisScript<Long> CLEAR_MARKER_SCRIPT = new DefaultRedisScript<>(
            "if redis.call('GET', KEYS[2]) == ARGV[1] "
                    + "and redis.call('GET', KEYS[3]) == ARGV[2] then "
                    + "return redis.call('DEL', KEYS[1], KEYS[2], KEYS[3]) end return 0",
            Long.class);

    private final CatalogService catalogService;
    private final ProductDetailCacheService cacheService;
    private final ProductDetailCacheSerializer serializer;
    private final ProductDetailCacheProperties properties;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final ScenarioRunGuard runGuard;

    public ProductDetailCacheProvisioningService(
            CatalogService catalogService,
            ProductDetailCacheService cacheService,
            ProductDetailCacheSerializer serializer,
            ProductDetailCacheProperties properties,
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper,
            ScenarioRunGuard runGuard) {
        this.catalogService = catalogService;
        this.cacheService = cacheService;
        this.serializer = serializer;
        this.properties = properties;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.runGuard = runGuard;
    }

    public Map<String, Object> start(ScenarioRunContext context, Map<String, Object> parameters) {
        context.validate(Instant.now());
        if (!runGuard.acceptStart(context)) {
            throw new BizException("STALE_SCENARIO_RUN", "Scenario token was rejected");
        }

        String runHash = cacheService.runHashKey(context.runId());
        String temporaryHash = runHash + ":tmp:" + context.fencingToken();
        boolean markerPublished = false;
        try {
            ProvisioningParameters values = validateParameters(context, parameters);
            List<ProductDTO> sellable = new ArrayList<>(catalogService.listSellableProducts());
            sellable.sort((left, right) -> left.getSku().compareTo(right.getSku()));
            if (sellable.size() <= values.memberCount()) {
                throw new BizException("INSUFFICIENT_SELLABLE_PRODUCTS",
                        "At least one sellable product must remain as the probe SKU");
            }
            if (values.memberCount() > sellable.size() - 1) {
                throw new BizException("MEMBER_COUNT_EXCEEDS_SELLABLE_PRODUCTS",
                        "memberCount exceeds the available sellable products");
            }

            ProductDTO probe = sellable.get(sellable.size() - 1);
            List<ProductDTO> members = sellable.subList(0, values.memberCount());
            Instant cachedAt = Instant.now();
            Instant envelopeExpiresAt = context.expiresAt().plusSeconds(Math.max(0, properties.getCleanupGraceSeconds()));
            Map<String, String> fields = new LinkedHashMap<>();
            long logicalBytes = 0;
            for (ProductDTO product : members) {
                String payload = serializer.serialize(
                        product.getSku(), product, cachedAt, envelopeExpiresAt, values.memberSizeBytes());
                fields.put(product.getSku(), payload);
                logicalBytes += serializer.utf8Length(payload);
            }
            if (logicalBytes > properties.getMaxLogicalBytes()) {
                throw new BizException("AGGREGATE_LOGICAL_BYTES_EXCEEDS_LIMIT",
                        "Aggregate product detail cache size exceeds the service limit");
            }

            redisTemplate.delete(temporaryHash);
            redisTemplate.opsForHash().putAll(temporaryHash, fields);
            Long actualCount = redisTemplate.opsForHash().size(temporaryHash);
            if (actualCount == null || actualCount != fields.size()) {
                throw new BizException("CACHE_HASH_VERIFICATION_FAILED", "Product detail Hash field count mismatch");
            }
            Duration resourceTtl = resourceTtl(context.expiresAt(), values.keyTtlSec());
            if (!Boolean.TRUE.equals(redisTemplate.expire(temporaryHash, resourceTtl))) {
                throw new BizException("CACHE_HASH_TTL_FAILED", "Product detail Hash TTL could not be set");
            }
            redisTemplate.rename(temporaryHash, runHash);

            Long observedBytes = memoryUsage(runHash);
            ProductDetailCacheMarker marker = marker(context, runHash, probe.getSku());
            String markerJson = writeMarker(marker);
            long markerTtlMillis = Math.max(1, resourceTtl.toMillis());
            Long published = redisTemplate.execute(
                    PUBLISH_MARKER_SCRIPT,
                    List.of(cacheService.activeMarkerKey(), cacheService.activeMarkerOwnerKey(), cacheService.activeMarkerFenceKey()),
                    markerJson,
                    String.valueOf(context.fencingToken()),
                    String.valueOf(markerTtlMillis),
                    context.runId());
            if (!Long.valueOf(1L).equals(published)) {
                throw new BizException("ACTIVE_MARKER_REJECTED", "Another product detail run owns the active marker");
            }
            markerPublished = true;
            runGuard.registerCleanup(context, () -> cleanupQuietly(context));

            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("accepted", true);
            summary.put("faultRunId", context.runId());
            summary.put("layout", "HASH");
            summary.put("hashKey", runHash);
            summary.put("memberCount", members.size());
            summary.put("memberSizeBytes", values.memberSizeBytes());
            summary.put("logicalBytes", logicalBytes);
            if (observedBytes != null) summary.put("observedBytes", observedBytes);
            summary.put("probeSku", probe.getSku());
            summary.put("expiresAt", context.expiresAt().toString());
            summary.put("keyTtlSec", resourceTtl.toSeconds());
            summary.put("memberSkus", members.stream().map(ProductDTO::getSku).toList());
            return Collections.unmodifiableMap(summary);
        } catch (RuntimeException exception) {
            if (markerPublished) clearMarker(context.runId(), context.fencingToken());
            redisTemplate.delete(temporaryHash);
            redisTemplate.delete(runHash);
            try {
                runGuard.release(context);
            } catch (RuntimeException ignored) {
            }
            throw exception;
        }
    }

    public Map<String, Object> stop(ScenarioRunContext context) {
        context.validateForRelease();
        Map<String, Object> result = cleanup(context);
        try {
            runGuard.release(context);
        } catch (RuntimeException exception) {
            throw new BizException("CACHE_RUN_RELEASE_FAILED", "Product detail run release failed", exception);
        }
        return result;
    }

    public Map<String, Object> cleanup(ScenarioRunContext context) {
        context.validateForRelease();
        return cleanup(context.runId(), context.fencingToken());
    }

    public Map<String, Object> cleanup(String runId, long fencingToken) {
        validateCleanupIdentity(runId, fencingToken);
        assertMarkerOwnershipOrAbsent(runId, fencingToken);
        boolean markerRemoved = clearMarker(runId, fencingToken);
        boolean hashRemoved = Boolean.TRUE.equals(redisTemplate.delete(cacheService.runHashKey(runId)));
        return Map.of(
                "released", true,
                "markerRemoved", markerRemoved,
                "hashRemoved", hashRemoved,
                "faultRunId", runId);
    }

    private void assertMarkerOwnershipOrAbsent(String runId, long fencingToken) {
        String marker = redisTemplate.opsForValue().get(cacheService.activeMarkerKey());
        String owner = redisTemplate.opsForValue().get(cacheService.activeMarkerOwnerKey());
        String fence = redisTemplate.opsForValue().get(cacheService.activeMarkerFenceKey());
        if (marker == null && owner == null && fence == null) return;
        if (runId.equals(owner) && String.valueOf(fencingToken).equals(fence)) return;
        throw new BizException("STALE_SCENARIO_RUN", "Product detail marker belongs to another run");
    }

    private void validateCleanupIdentity(String runId, long fencingToken) {
        try {
            UUID.fromString(runId);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("Invalid scenario cleanup context", exception);
        }
        if (fencingToken < 1) throw new IllegalArgumentException("Invalid scenario cleanup context");
    }

    private ProvisioningParameters validateParameters(
            ScenarioRunContext context, Map<String, Object> parameters) {
        if (parameters == null || !ALLOWED_PARAMETERS.containsAll(parameters.keySet())) {
            throw new BizException("UNKNOWN_PARAMETER", "Unsupported product detail run parameter");
        }
        int durationSec = integer(parameters, "durationSec", 600, 1, 1800);
        int memberCount = integer(parameters, "memberCount", 8, 1, properties.getMaxMemberCount());
        int memberSizeBytes = integer(parameters, "memberSizeBytes", 32 * 1024 * 1024,
                1, properties.getMaxMemberSizeBytes());
        int keyTtlSec = integer(parameters, "keyTtlSec", 900, 1, 3600);
        int grace = Math.max(0, properties.getCleanupGraceSeconds());
        if (keyTtlSec < durationSec + grace) {
            throw new BizException("KEY_TTL_TOO_SHORT", "keyTtlSec must cover the run and cleanup grace period");
        }
        if ((long) memberCount * memberSizeBytes > properties.getMaxLogicalBytes()) {
            throw new BizException("AGGREGATE_LOGICAL_BYTES_EXCEEDS_LIMIT",
                    "Aggregate product detail cache size exceeds the service limit");
        }
        if (!context.expiresAt().isAfter(Instant.now())) {
            throw new BizException("STALE_SCENARIO_RUN", "Scenario run has expired");
        }
        return new ProvisioningParameters(durationSec, memberCount, memberSizeBytes, keyTtlSec);
    }

    private int integer(Map<String, Object> parameters, String name, int defaultValue, int min, int max) {
        Object raw = parameters.get(name);
        if (raw == null) return defaultValue;
        if (!(raw instanceof Number number)
                || !Double.isFinite(number.doubleValue())
                || number.doubleValue() != number.longValue()
                || number.longValue() < min
                || number.longValue() > max) {
            throw new BizException("INVALID_PARAMETER", name + " is out of range");
        }
        return number.intValue();
    }

    private Duration resourceTtl(Instant expiresAt, int requestedTtlSec) {
        long remainingMillis = Math.max(1, Duration.between(Instant.now(), expiresAt).toMillis());
        long remainingWithGrace = (long) Math.ceil(remainingMillis / 1000.0)
                + Math.max(0, properties.getCleanupGraceSeconds());
        return Duration.ofSeconds(Math.max(1, Math.min(requestedTtlSec, remainingWithGrace)));
    }

    private ProductDetailCacheMarker marker(ScenarioRunContext context, String runHash, String probeSku) {
        ProductDetailCacheMarker marker = new ProductDetailCacheMarker();
        marker.setSchemaVersion(ProductDetailCacheSerializer.SCHEMA_VERSION);
        marker.setFaultRunId(context.runId());
        marker.setFencingToken(context.fencingToken());
        marker.setHashKey(runHash);
        marker.setProbeSku(probeSku);
        marker.setExpiresAt(context.expiresAt().toString());
        return marker;
    }

    private String writeMarker(ProductDetailCacheMarker marker) {
        try {
            return objectMapper.writeValueAsString(marker);
        } catch (JsonProcessingException exception) {
            throw new BizException("CACHE_MARKER_SERIALIZATION_FAILED", "Product detail marker could not be serialized", exception);
        }
    }

    private Long memoryUsage(String key) {
        try {
            return redisTemplate.execute((RedisCallback<Long>) connection -> {
                Object raw = connection.execute("MEMORY",
                        "USAGE".getBytes(StandardCharsets.UTF_8), key.getBytes(StandardCharsets.UTF_8));
                if (raw instanceof Number number) return number.longValue();
                if (raw instanceof byte[] bytes) return Long.parseLong(new String(bytes, StandardCharsets.UTF_8));
                return null;
            });
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private boolean clearMarker(String runId, long fencingToken) {
        Long cleared = redisTemplate.execute(
                CLEAR_MARKER_SCRIPT,
                List.of(cacheService.activeMarkerKey(), cacheService.activeMarkerOwnerKey(), cacheService.activeMarkerFenceKey()),
                runId, String.valueOf(fencingToken));
        return Long.valueOf(1L).equals(cleared);
    }

    private void cleanupQuietly(ScenarioRunContext context) {
        try {
            cleanup(context);
        } catch (RuntimeException ignored) {
        }
    }

    private record ProvisioningParameters(int durationSec, int memberCount, int memberSizeBytes, int keyTtlSec) {
    }
}
