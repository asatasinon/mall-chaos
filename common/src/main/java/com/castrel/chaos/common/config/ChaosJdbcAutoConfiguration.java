package com.castrel.chaos.common.config;

import com.castrel.chaos.common.chaos.SlowSqlChaosService;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Auto-configuration for JDBC-dependent chaos services.
 * Kept separate so that reactive services (gateway) without spring-jdbc
 * on the classpath are not affected.
 */
@AutoConfiguration
@ConditionalOnClass(JdbcTemplate.class)
public class ChaosJdbcAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public SlowSqlChaosService slowSqlChaosService(
            @org.springframework.beans.factory.annotation.Autowired(required = false)
            JdbcTemplate jdbcTemplate) {
        return new SlowSqlChaosService(jdbcTemplate);
    }
}
