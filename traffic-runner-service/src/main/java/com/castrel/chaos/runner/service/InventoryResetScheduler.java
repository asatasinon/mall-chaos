package com.castrel.chaos.runner.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class InventoryResetScheduler {

    private static final Logger log = LoggerFactory.getLogger(InventoryResetScheduler.class);

    @Autowired
    private TrafficRunnerService runnerService;

    // Every 30 minutes — executes within allowed window (00:00-06:00)
    @Scheduled(cron = "0 */30 * * * *")
    public void scheduledReset() {
        java.time.LocalTime now = java.time.LocalTime.now(java.time.ZoneId.of("Asia/Shanghai"));
        java.time.LocalTime start = java.time.LocalTime.of(0, 0);
        java.time.LocalTime end = java.time.LocalTime.of(6, 0);
        if (now.isAfter(start) && now.isBefore(end)) {
            log.info("Scheduled inventory reset triggered at {}", now);
            runnerService.triggerInventoryReset(false);
        } else {
            log.debug("Inventory reset skipped — outside allowed window (00:00-06:00), current: {}", now);
        }
    }
}
