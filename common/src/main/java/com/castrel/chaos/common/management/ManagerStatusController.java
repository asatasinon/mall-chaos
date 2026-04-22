package com.castrel.chaos.common.management;

import org.springframework.boot.actuate.health.HealthComponent;
import org.springframework.boot.actuate.health.HealthEndpoint;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Compatibility endpoint for legacy probes still hitting /manager/status.
 */
@RestController
@ConditionalOnBean(HealthEndpoint.class)
public class ManagerStatusController {

    private final HealthEndpoint healthEndpoint;

    public ManagerStatusController(HealthEndpoint healthEndpoint) {
        this.healthEndpoint = healthEndpoint;
    }

    @GetMapping({"/manager/status", "/manager/status/"})
    public HealthComponent status() {
        return healthEndpoint.health();
    }
}