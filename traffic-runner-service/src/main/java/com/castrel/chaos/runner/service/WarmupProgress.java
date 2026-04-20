package com.castrel.chaos.runner.service;

public record WarmupProgress(
        long priceHistoryCount,
        long priceHistoryTarget,
        long behaviorLogCount,
        long behaviorLogTarget,
        boolean completed,
        String status
) {
    public double percentage() {
        long total = priceHistoryTarget + behaviorLogTarget;
        if (total == 0) return 100.0;
        return (double) (priceHistoryCount + behaviorLogCount) / total * 100;
    }
}
