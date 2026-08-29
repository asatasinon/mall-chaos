package com.castrel.chaos.inventory.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.IntStream;

@Data
@Component
@ConfigurationProperties(prefix = "inventory.demo-baseline")
public class DemoInventoryBaselineProperties {
    private boolean enabled = true;
    private List<String> skus = IntStream.rangeClosed(1, 50)
            .mapToObj(index -> "SKU-%03d".formatted(index))
            .toList();
    private int targetAvailableQty = 1_000_000;
}
