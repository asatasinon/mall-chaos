package com.castrel.chaos.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@ConfigurationProperties(prefix = "chaos.toxiproxy")
public class ToxiproxyProperties {

    private String apiUrl = "http://localhost:18474";
    private List<String> proxyWhitelist = List.of();

    public String getApiUrl() {
        return apiUrl;
    }

    public void setApiUrl(String apiUrl) {
        this.apiUrl = apiUrl;
    }

    public List<String> getProxyWhitelist() {
        return proxyWhitelist;
    }

    public void setProxyWhitelist(List<String> proxyWhitelist) {
        this.proxyWhitelist = proxyWhitelist;
    }

    public boolean isProxyAllowed(String proxyName) {
        return proxyWhitelist.contains(proxyName);
    }
}
