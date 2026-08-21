package com.castrel.chaos.common.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.ComponentScan;

@AutoConfiguration
@ConditionalOnWebApplication
@ComponentScan(basePackages = "com.castrel.chaos.common.security")
public class SecurityAutoConfiguration {
}