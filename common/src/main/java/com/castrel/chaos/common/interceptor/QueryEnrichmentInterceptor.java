package com.castrel.chaos.common.interceptor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Checks whether the current service should enrich its SQL queries by joining
 * an auxiliary data table. Configuration is read from a Redis Hash and cached
 * locally for 5 seconds to minimise Redis round-trips.
 */
@Component
public class QueryEnrichmentInterceptor {

    private static final Logger log = LoggerFactory.getLogger(QueryEnrichmentInterceptor.class);
    private static final String REDIS_KEY_PREFIX = "castrel:query:enrichment:";
    private static final String LEGACY_REDIS_KEY = "castrel:query:enrichment";
    private static final long REFRESH_INTERVAL_MS = 5_000;

    private final StringRedisTemplate redisTemplate;

    @Value("${spring.application.name:unknown}")
    private String serviceName;

    private volatile EnrichmentConfig cachedConfig;
    private volatile long lastRefresh = 0;

    public QueryEnrichmentInterceptor(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Returns {@code true} when the current request should JOIN the configured
     * large table. Returns {@code false} on any Redis error (fail-safe).
     */
    public boolean shouldEnrich() {
        refreshConfigIfNeeded();
        if (cachedConfig == null || !cachedConfig.enabled()) return false;
        if (cachedConfig.targetServices().isEmpty()) return true;
        return cachedConfig.targetServices().contains(serviceName);
    }

    /** Returns the table name to JOIN, or {@code null} when enrichment is off. */
    public String getJoinTable() {
        return cachedConfig != null ? cachedConfig.joinTable() : null;
    }

    public int getLimitRows() {
        return cachedConfig != null ? cachedConfig.limitRows() : 1;
    }

    public int getOffsetRows() {
        return cachedConfig != null ? cachedConfig.offsetRows() : 0;
    }

    // ── internal ─────────────────────────────────────────────────────────────

    private void refreshConfigIfNeeded() {
        long now = System.currentTimeMillis();
        if (now - lastRefresh < REFRESH_INTERVAL_MS) return;
        lastRefresh = now;

        try {
            Map<Object, Object> hash = redisTemplate.opsForHash().entries(redisKeyForService());
            // Backward compatible fallback for old single-key layout.
            if (hash.isEmpty()) {
                hash = redisTemplate.opsForHash().entries(LEGACY_REDIS_KEY);
            }
            if (hash.isEmpty()) {
                cachedConfig = null;
                return;
            }
            cachedConfig = new EnrichmentConfig(
                    "true".equals(hash.get("enabled")),
                    (String) hash.get("joinTable"),
                    parseServiceList((String) hash.get("targetServices")),
                    parsePositiveInt((String) hash.get("limitRows"), 1),
                    parseNonNegativeInt((String) hash.get("offsetRows"), 200000)
            );
        } catch (Exception e) {
            // Redis unavailable → fail-safe: no enrichment
            log.debug("Failed to read query enrichment config from Redis, disabling enrichment", e);
            cachedConfig = null;
        }
    }

    private Set<String> parseServiceList(String csv) {
        if (csv == null || csv.isBlank()) return Collections.emptySet();
        return Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
    }

    private String redisKeyForService() {
        return REDIS_KEY_PREFIX + serviceName;
    }

    private int parsePositiveInt(String value, int defaultValue) {
        if (value == null || value.isBlank()) return defaultValue;
        try {
            int parsed = Integer.parseInt(value.trim());
            return parsed > 0 ? parsed : defaultValue;
        } catch (NumberFormatException ignore) {
            return defaultValue;
        }
    }

    private int parseNonNegativeInt(String value, int defaultValue) {
        if (value == null || value.isBlank()) return defaultValue;
        try {
            int parsed = Integer.parseInt(value.trim());
            return Math.max(parsed, 0);
        } catch (NumberFormatException ignore) {
            return defaultValue;
        }
    }
}
