package com.castrel.chaos.promotion.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;

@Data
@Component
@ConfigurationProperties(prefix = "promotion.demo-coupon-pool")
public class DemoCouponPoolProperties {
    private boolean enabled = true;
    private List<Long> customerIds = List.of(1L, 2L);
    private List<String> promotionTypes = List.of("DISCOUNT", "COUPON");
    private int targetAvailableCount = 3;
    private int replenishBelowCount = 1;
    private int validityHours = 168;
}
