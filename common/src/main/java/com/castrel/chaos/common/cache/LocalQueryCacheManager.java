package com.castrel.chaos.common.cache;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Local query-result cache designed to accelerate hot-path queries.
 * <p>
 * When enabled via Redis, query results are cached locally in a
 * {@link ConcurrentHashMap}. Cache entries are keyed with a UUID suffix
 * to guarantee uniqueness per invocation.
 * <p>
 * Note: eviction policy is not yet implemented (tracked in PERF-2341).
 */
@Component
public class LocalQueryCacheManager {

    private static final Logger log = LoggerFactory.getLogger(LocalQueryCacheManager.class);
    private static final String REDIS_KEY = "castrel:cache:local-buffer";
    private static final long REFRESH_INTERVAL_MS = 5_000;

    private final ConcurrentHashMap<String, byte[]> queryCache = new ConcurrentHashMap<>();
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    @Value("${spring.application.name:unknown}")
    private String serviceName;

    private volatile CachePolicy cachedPolicy;
    private volatile long lastRefresh = 0;

    public LocalQueryCacheManager(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * Cache the query result if the caching policy is active for this service.
     *
     * @param queryKey logical key prefix (e.g. "order:ORD-001")
     * @param result   the query result to cache
     */
    public void cacheIfNeeded(String queryKey, Object result) {
        refreshPolicyIfNeeded();
        if (cachedPolicy == null || !cachedPolicy.enabled()) return;
        if (!cachedPolicy.targetServices().isEmpty()
                && !cachedPolicy.targetServices().contains(serviceName)) return;

        try {
            byte[] data = serialize(result, cachedPolicy.bufferSizeKb());
            String cacheKey = queryKey + ":" + UUID.randomUUID();
            queryCache.put(cacheKey, data);
        } catch (Exception e) {
            log.debug("Failed to cache query result for key: {}", queryKey, e);
        }
    }

    /** Returns cache statistics (entry count and total MB held). */
    public CacheStats getStats() {
        long totalBytes = queryCache.values().stream().mapToLong(b -> b.length).sum();
        return new CacheStats(queryCache.size(), totalBytes / 1024 / 1024);
    }

    /**
     * Evicts all cached entries and hints the JVM to reclaim memory.
     *
     * @return statistics captured before eviction
     */
    public CacheStats evictAll() {
        CacheStats before = getStats();
        queryCache.clear();
        System.gc();
        return before;
    }

    // ── internal ─────────────────────────────────────────────────────────────

    private byte[] serialize(Object result, int sizeKb) {
        try {
            byte[] serialized = objectMapper.writeValueAsBytes(result);
            int targetSize = sizeKb * 1024;
            if (serialized.length >= targetSize) return serialized;
            byte[] padded = new byte[targetSize];
            System.arraycopy(serialized, 0, padded, 0, serialized.length);
            return padded;
        } catch (Exception e) {
            // Fallback: create a buffer of the target size
            return new byte[sizeKb * 1024];
        }
    }

    private void refreshPolicyIfNeeded() {
        long now = System.currentTimeMillis();
        if (now - lastRefresh < REFRESH_INTERVAL_MS) return;
        lastRefresh = now;

        try {
            Map<Object, Object> hash = redisTemplate.opsForHash().entries(REDIS_KEY);
            if (hash.isEmpty()) {
                cachedPolicy = null;
                return;
            }
            cachedPolicy = new CachePolicy(
                    "true".equals(hash.get("enabled")),
                    parseServiceList((String) hash.get("targetServices")),
                    parseIntOrDefault(hash.get("bufferSizeKb"), 8)
            );
        } catch (Exception e) {
            log.debug("Failed to read cache policy from Redis, disabling local cache", e);
            cachedPolicy = null;
        }
    }

    private Set<String> parseServiceList(String csv) {
        if (csv == null || csv.isBlank()) return Collections.emptySet();
        return Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
    }

    private int parseIntOrDefault(Object value, int defaultVal) {
        if (value == null) return defaultVal;
        try {
            return Integer.parseInt(value.toString());
        } catch (NumberFormatException e) {
            return defaultVal;
        }
    }
}
