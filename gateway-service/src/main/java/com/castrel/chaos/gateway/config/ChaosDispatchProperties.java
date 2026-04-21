package com.castrel.chaos.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
@ConfigurationProperties(prefix = "chaos.dispatch")
public class ChaosDispatchProperties {

    private Map<String, String> services = Map.of();
    private Map<String, List<String>> whitelist = Map.of();

    public Map<String, String> getServices() {
        return services;
    }

    public void setServices(Map<String, String> services) {
        this.services = services;
    }

    public Map<String, List<String>> getWhitelist() {
        return whitelist;
    }

    public void setWhitelist(Map<String, List<String>> whitelist) {
        this.whitelist = whitelist;
    }

    public String getServiceUrl(String serviceName) {
        return services.get(serviceName);
    }

    public boolean isAllowed(String chaosType, String serviceName) {
        List<String> allowed = whitelist.get(chaosType);
        return allowed != null && allowed.contains(serviceName);
    }

    public List<String> getAllowedServices(String chaosType) {
        return whitelist.getOrDefault(chaosType, List.of());
    }
}
