package com.castrel.chaos.common.config;

import com.castrel.chaos.common.chaos.SlowSqlChaosService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Auto-configuration for JDBC-dependent chaos services.
 * Kept separate so that reactive services (gateway) without spring-jdbc
 * on the classpath are not affected.
 * <p>
 * SlowSqlChaosService is always registered (other services autowire it) but
 * the DB state-restore call ({@code syncFromDb}) is guarded by the {@code chaos}
 * profile. On local/docker profiles the bean starts with {@code enabled=false}
 * and the in-memory state is never polluted by leftover chaos_switch rows.
 */
@AutoConfiguration
@ConditionalOnClass(JdbcTemplate.class)
public class ChaosJdbcAutoConfiguration {

    /** Standard bean — present on every profile but starts fully disabled. */
    @Bean
    @ConditionalOnMissingBean
    public SlowSqlChaosService slowSqlChaosService(
            @org.springframework.beans.factory.annotation.Autowired(required = false)
            JdbcTemplate jdbcTemplate,
            @Value("${spring.application.name:unknown}") String applicationName) {
        return new SlowSqlChaosService(jdbcTemplate, applicationName);
    }

    /**
     * Restores persisted chaos state only when the {@code chaos} profile is active.
     * This prevents baseline runs from accidentally re-enabling slow SQL because
     * a stale row with {@code enabled=1} was left in {@code chaos_switch}.
     */
    @Bean
    @Profile("chaos")
    @ConditionalOnMissingBean(name = "slowSqlChaosSyncRunner")
    public org.springframework.boot.ApplicationRunner slowSqlChaosSyncRunner(
            SlowSqlChaosService slowSqlChaosService) {
        return args -> slowSqlChaosService.syncFromDb();
    }
}
