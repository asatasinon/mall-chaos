package com.castrel.chaos.common.interceptor;

import java.util.Collections;
import java.util.Set;

public record EnrichmentConfig(
        boolean enabled,
        String joinTable,
        Set<String> targetServices,
        int limitRows,
        int offsetRows
) {
    public EnrichmentConfig {
        if (targetServices == null) targetServices = Collections.emptySet();
        if (limitRows <= 0) limitRows = 1;
        if (offsetRows < 0) offsetRows = 0;
    }
}
