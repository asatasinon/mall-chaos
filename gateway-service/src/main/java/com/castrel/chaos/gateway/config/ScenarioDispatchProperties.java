package com.castrel.chaos.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
@ConfigurationProperties(prefix = "scenario-dispatch.dispatch")
public class ScenarioDispatchProperties {

    private Map<String, String> services = Map.of();

    public Map<String, String> getServices() {
        return services;
    }

    public void setServices(Map<String, String> services) {
        this.services = services;
    }

    public String getServiceUrl(String serviceName) {
        return services.get(serviceName);
    }
}