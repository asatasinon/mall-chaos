package com.castrel.chaos.runner.model;

import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * In-memory snapshot of runner configuration.
 * Replaced atomically on hot-update.
 */
@Data
public class RunnerConfig {
    private int version;
    private int baseQps;
    private float peakMultiplier;
    private int cycleMinutes;
    private float jitterPct;
    private List<MixRule> mixRules;

    @Data
    public static class MixRule {
        private String actionType;
        private float ratio;
    }

    /** Weighted random pick of action type. */
    public String pickAction(double random) {
        double cumulative = 0;
        for (MixRule rule : mixRules) {
            cumulative += rule.getRatio();
            if (random < cumulative) return rule.getActionType();
        }
        return "ORDER_SUCCESS";
    }

    /** Effective QPS at given time offset (sinusoidal wave). */
    public double effectiveQps(long nowMillis) {
        if (cycleMinutes <= 0) return baseQps * peakMultiplier;
        double phase = (nowMillis % (cycleMinutes * 60_000L)) / (cycleMinutes * 60_000.0);
        double sinFactor = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
        double base = baseQps + (baseQps * (peakMultiplier - 1) * sinFactor);
        double jitter = 1.0 + (Math.random() * 2 - 1) * jitterPct;
        return Math.max(1, base * jitter);
    }
}
