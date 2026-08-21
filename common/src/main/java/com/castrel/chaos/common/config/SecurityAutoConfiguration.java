package com.castrel.chaos.common.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.ComponentScan;

@AutoConfiguration
@ComponentScan(basePackages = "com.castrel.chaos.common.security")
public class SecurityAutoConfiguration {
}