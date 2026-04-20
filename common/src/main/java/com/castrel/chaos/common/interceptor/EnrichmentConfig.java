package com.castrel.chaos.common.interceptor;

import java.util.Collections;
import java.util.Set;

public record EnrichmentConfig(
        boolean enabled,
        String joinTable,
        Set<String> targetServices
) {
    public EnrichmentConfig {
        if (targetServices == null) targetServices = Collections.emptySet();
    }
}
