package com.castrel.chaos.common.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.ComponentScan;

/**
 * Auto-configuration for shared service components including query enrichment,
 * data audit, and local cache management.
 */
@AutoConfiguration
@ConditionalOnClass(name = "org.springframework.data.redis.core.StringRedisTemplate")
@ComponentScan(basePackages = {
        "com.castrel.chaos.common.interceptor",
        "com.castrel.chaos.common.maintenance",
        "com.castrel.chaos.common.cache",
        "com.castrel.chaos.common.chaos"
})
public class ServiceComponentAutoConfiguration {
}
