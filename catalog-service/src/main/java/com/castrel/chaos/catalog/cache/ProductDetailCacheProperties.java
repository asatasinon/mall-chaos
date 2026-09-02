package com.castrel.chaos.catalog.cache;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
@ConfigurationProperties(prefix = "catalog.product-detail-cache")
public class ProductDetailCacheProperties {

    private String defaultKey = "catalog:product-detail:cache";
    private String activeMarkerKey = "catalog:product-detail:active";
    private String activeMarkerOwnerKey = "catalog:product-detail:active:owner";
    private String activeMarkerFenceKey = "catalog:product-detail:active:fence";
    private Duration logicalTtl = Duration.ofMinutes(5);
    private Duration runFallbackTtl = Duration.ofMinutes(31);
    private long maxLogicalBytes = 64L * 1024 * 1024;
    private int maxMemberCount = 47;
    private int maxMemberSizeBytes = 4 * 1024 * 1024;
    private int cleanupGraceSeconds = 60;

    public String getDefaultKey() {
        return defaultKey;
    }

    public void setDefaultKey(String defaultKey) {
        this.defaultKey = defaultKey;
    }

    public String getActiveMarkerKey() {
        return activeMarkerKey;
    }

    public void setActiveMarkerKey(String activeMarkerKey) {
        this.activeMarkerKey = activeMarkerKey;
    }

    public String getActiveMarkerOwnerKey() {
        return activeMarkerOwnerKey;
    }

    public void setActiveMarkerOwnerKey(String activeMarkerOwnerKey) {
        this.activeMarkerOwnerKey = activeMarkerOwnerKey;
    }

    public String getActiveMarkerFenceKey() {
        return activeMarkerFenceKey;
    }

    public void setActiveMarkerFenceKey(String activeMarkerFenceKey) {
        this.activeMarkerFenceKey = activeMarkerFenceKey;
    }

    public Duration getLogicalTtl() {
        return logicalTtl;
    }

    public void setLogicalTtl(Duration logicalTtl) {
        this.logicalTtl = logicalTtl;
    }

    public Duration getRunFallbackTtl() {
        return runFallbackTtl;
    }

    public void setRunFallbackTtl(Duration runFallbackTtl) {
        this.runFallbackTtl = runFallbackTtl;
    }

    public long getMaxLogicalBytes() {
        return maxLogicalBytes;
    }

    public void setMaxLogicalBytes(long maxLogicalBytes) {
        this.maxLogicalBytes = maxLogicalBytes;
    }

    public int getMaxMemberCount() {
        return maxMemberCount;
    }

    public void setMaxMemberCount(int maxMemberCount) {
        this.maxMemberCount = maxMemberCount;
    }

    public int getMaxMemberSizeBytes() {
        return maxMemberSizeBytes;
    }

    public void setMaxMemberSizeBytes(int maxMemberSizeBytes) {
        this.maxMemberSizeBytes = maxMemberSizeBytes;
    }

    public int getCleanupGraceSeconds() {
        return cleanupGraceSeconds;
    }

    public void setCleanupGraceSeconds(int cleanupGraceSeconds) {
        this.cleanupGraceSeconds = cleanupGraceSeconds;
    }
}