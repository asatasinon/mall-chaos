package com.castrel.chaos.common.config;

import com.castrel.chaos.common.maintenance.DataAuditService;
import com.castrel.chaos.common.management.SchemaVersionHealthIndicator;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.ComponentScan.Filter;
import org.springframework.context.annotation.FilterType;
import org.springframework.data.redis.core.StringRedisTemplate;

import javax.sql.DataSource;

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
}, excludeFilters = @Filter(
                type = FilterType.ASSIGNABLE_TYPE,
                classes = {DataAuditService.class, SchemaVersionHealthIndicator.class}))
public class ServiceComponentAutoConfiguration {

        @Bean
        @ConditionalOnBean(DataSource.class)
        DataAuditService dataAuditService(DataSource dataSource, StringRedisTemplate redisTemplate) {
                return new DataAuditService(dataSource, redisTemplate);
        }

        @Bean("schemaVersion")
        @ConditionalOnBean(DataSource.class)
        SchemaVersionHealthIndicator schemaVersionHealthIndicator(
                        DataSource dataSource,
                        @org.springframework.beans.factory.annotation.Value("${castrel.schema.expected-version:1}") int expectedVersion) {
                return new SchemaVersionHealthIndicator(dataSource, expectedVersion);
        }
}
