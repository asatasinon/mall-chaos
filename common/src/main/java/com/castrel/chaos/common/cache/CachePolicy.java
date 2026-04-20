package com.castrel.chaos.common.cache;

import java.util.Collections;
import java.util.Set;

record CachePolicy(
        boolean enabled,
        Set<String> targetServices,
        int bufferSizeKb
) {
    CachePolicy {
        if (targetServices == null) targetServices = Collections.emptySet();
        if (bufferSizeKb <= 0) bufferSizeKb = 8;
    }
}
