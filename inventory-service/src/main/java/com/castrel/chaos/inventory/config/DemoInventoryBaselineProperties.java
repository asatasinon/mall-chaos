package com.castrel.chaos.inventory.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;

@Data
@Component
@ConfigurationProperties(prefix = "inventory.demo-baseline")
public class DemoInventoryBaselineProperties {
    private boolean enabled = true;
    private List<String> skus = List.of("SKU-001", "SKU-002");
    private int targetAvailableQty = 100;
}
