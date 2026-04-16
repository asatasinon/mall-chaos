package com.castrel.chaos.common.config;

import com.castrel.chaos.common.chaos.MemoryLeakChaosService;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;

@AutoConfiguration
public class ChaosCommonAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public MemoryLeakChaosService memoryLeakChaosService() {
        return new MemoryLeakChaosService();
    }
}
