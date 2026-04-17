package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class ConsoleConfigController {

    @Value("${chaos.console.grafana-base-url:}")
    private String grafanaBaseUrl;

    @GetMapping("/internal/console/config")
    public ApiResponse<Map<String, String>> config() {
        return ApiResponse.ok(Map.of(
                "grafanaBaseUrl", grafanaBaseUrl == null ? "" : grafanaBaseUrl.trim()
        ));
    }
}
