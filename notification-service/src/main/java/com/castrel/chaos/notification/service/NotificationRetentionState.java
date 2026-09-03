package com.castrel.chaos.notification.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class NotificationRetentionState {
    private final CopyOnWriteArrayList<byte[]> retainedObjects = new CopyOnWriteArrayList<>();
    private final AtomicLong storageBytes = new AtomicLong();
    private volatile ScenarioRunContext retentionRun;
    private volatile ScenarioRunContext storageRun;
    private volatile long requestIntervalMs = 100;
    private volatile int retainedBytesPerNotification = 1024 * 1024;
    private volatile long totalStorageBytes = 10L * 1024 * 1024 * 1024;
    private volatile long appendBytes = 16L * 1024 * 1024;
    private volatile long minFreeBytes = 1;
    private volatile long lastRetainedAt;
    private volatile long lastAppendedAt;

    public synchronized void prepare(ScenarioRunContext context, String scenario,
                                      Map<String, Object> parameters, ScenarioRunGuard guard) {
        context.validate(Instant.now());
        if (!guard.acceptStart(context)) throw new BizException("STALE_SCENARIO_RUN", "Scenario token was rejected");
        if ("NOTIFICATION_HEAP_PRESSURE".equals(scenario)) {
            if (retentionRun != null && !retentionRun.runId().equals(context.runId())) {
                throw new BizException("SCENARIO_RUN_ALREADY_ACTIVE", "Another notification operation is active");
            }
            if (retentionRun != null && retentionRun.runId().equals(context.runId())) return;
            retentionRun = context;
            requestIntervalMs = bounded(parameters, "requestIntervalMs", 100, 0, 60000);
            retainedBytesPerNotification = (int) bounded(parameters, "retainedBytesPerNotification", 1024 * 1024, 1024, 10L * 1024 * 1024);
            guard.registerCleanup(context, () -> retentionRun = null);
        } else if ("NOTIFICATION_STORAGE_APPEND".equals(scenario)) {
            if (storageRun != null && !storageRun.runId().equals(context.runId())) {
                throw new BizException("SCENARIO_RUN_ALREADY_ACTIVE", "Another notification operation is active");
            }
            if (storageRun != null && storageRun.runId().equals(context.runId())) return;
            storageRun = context;
            requestIntervalMs = bounded(parameters, "requestIntervalMs", 100, 0, 60000);
            totalStorageBytes = bounded(parameters, "totalBytes", 10L * 1024 * 1024 * 1024, 1024, Long.MAX_VALUE);
            appendBytes = bounded(parameters, "appendBytes", 16L * 1024 * 1024, 1, 64L * 1024 * 1024);
            minFreeBytes = bounded(parameters, "minFreeBytes", 1, 1, 1073741824);
            storageBytes.set(0);
            guard.registerCleanup(context, () -> storageRun = null);
        } else {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported notification operation");
        }
    }

    public synchronized void release(ScenarioRunContext context, ScenarioRunGuard guard) {
        context.validateForRelease();
        guard.release(context);
        if (context.runId().equals(retentionRun == null ? null : retentionRun.runId())) retentionRun = null;
        if (context.runId().equals(storageRun == null ? null : storageRun.runId())) storageRun = null;
    }

    public synchronized void stopAllStorageOperations(ScenarioRunGuard guard) {
        if (storageRun != null) {
            guard.release(storageRun);
            storageRun = null;
        }
    }

    public boolean shouldRetain() {
        ScenarioRunContext run = retentionRun;
        if (run == null || !run.expiresAt().isAfter(Instant.now())) return false;
        long now = System.currentTimeMillis();
        if (now - lastRetainedAt < requestIntervalMs) return false;
        lastRetainedAt = now;
        retainedObjects.add(new byte[retainedBytesPerNotification]);
        return true;
    }

    public String storageOperationRunId() {
        ScenarioRunContext run = storageRun;
        return run != null && run.expiresAt().isAfter(Instant.now()) ? run.runId() : null;
    }

    public long reserveStorage(long payloadBytes) {
        if (storageOperationRunId() == null) return 0;
        long now = System.currentTimeMillis();
        if (now - lastAppendedAt < requestIntervalMs) throw new BizException("STORAGE_APPEND_RATE_LIMIT", "Notification append rate is limited");
        long next = storageBytes.addAndGet(Math.max(payloadBytes, appendBytes));
        if (next > totalStorageBytes || totalStorageBytes - next < minFreeBytes) {
            storageBytes.addAndGet(-Math.max(payloadBytes, appendBytes));
            throw new BizException("STORAGE_CAPACITY_GUARD", "Notification storage guard is active");
        }
        lastAppendedAt = now;
        return next;
    }

    public int retainedEntries() {
        return retainedObjects.size();
    }

    private long bounded(Map<String, Object> parameters, String name, long defaultValue, long min, long max) {
        Object value = parameters == null ? null : parameters.get(name);
        long result = value instanceof Number number ? number.longValue() : defaultValue;
        if (result < min || result > max) throw new BizException("INVALID_NOTIFICATION_PARAMETER", name + " is out of range");
        return result;
    }
}