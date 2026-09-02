package com.castrel.chaos.catalog.cache;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
@ConfigurationProperties(prefix = "catalog.product-detail-cache")
public class ProductDetailCacheProperties {

    private String defaultKey = "catalog:product-detail:cache";
    private String activeMarkerKey = "catalog:product-detail:active";
    private Duration logicalTtl = Duration.ofMinutes(5);

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

    public Duration getLogicalTtl() {
        return logicalTtl;
    }

    public void setLogicalTtl(Duration logicalTtl) {
        this.logicalTtl = logicalTtl;
    }
}