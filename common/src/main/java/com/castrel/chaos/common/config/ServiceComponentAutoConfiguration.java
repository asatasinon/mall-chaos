package com.castrel.chaos.common.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.ComponentScan;

/**
 * Auto-configuration for shared business maintenance components and schema
 * readiness verification.
 */
@AutoConfiguration
@ConditionalOnClass(name = "org.springframework.data.redis.core.StringRedisTemplate")
@ComponentScan(basePackages = {
        "com.castrel.chaos.common.interceptor",
        "com.castrel.chaos.common.maintenance",
        "com.castrel.chaos.common.cache",
        "com.castrel.chaos.common.management",
        "com.castrel.chaos.common.storage",
        "com.castrel.chaos.common.coordination"
})
public class ServiceComponentAutoConfiguration {
}
