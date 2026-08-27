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
public class NotificationExerciseState {
    private final CopyOnWriteArrayList<byte[]> retainedObjects = new CopyOnWriteArrayList<>();
    private final AtomicLong storageBytes = new AtomicLong();
    private volatile ScenarioRunContext heapRun;
    private volatile ScenarioRunContext storageRun;
    private volatile int retainedBytesPerNotification = 4096;
    private volatile long totalStorageBytes = 16L * 1024 * 1024;
    private volatile long appendBytes = 1024;
    private volatile long minFreeBytes = 1;
    private volatile long lastRetainedAt;
    private volatile long lastAppendedAt;

    public synchronized void start(ScenarioRunContext context, String scenario,
                                   Map<String, Object> parameters, ScenarioRunGuard guard) {
        context.validate(Instant.now());
        if (!guard.acceptStart(context)) throw new BizException("STALE_SCENARIO_RUN", "Scenario token was rejected");
        if ("NOTIFICATION_HEAP_PRESSURE".equals(scenario)) {
            if (heapRun != null && !heapRun.runId().equals(context.runId())) {
                throw new BizException("SCENARIO_RUN_ALREADY_ACTIVE", "Another notification run is active");
            }
            if (heapRun != null && heapRun.runId().equals(context.runId())) return;
            heapRun = context;
            retainedBytesPerNotification = (int) bounded(parameters, "retainedBytesPerNotification", 4096, 1024, 1048576);
            guard.registerCleanup(context, () -> heapRun = null);
        } else if ("NOTIFICATION_STORAGE_APPEND".equals(scenario)) {
            if (storageRun != null && !storageRun.runId().equals(context.runId())) {
                throw new BizException("SCENARIO_RUN_ALREADY_ACTIVE", "Another notification run is active");
            }
            if (storageRun != null && storageRun.runId().equals(context.runId())) return;
            storageRun = context;
            totalStorageBytes = bounded(parameters, "totalBytes", 16L * 1024 * 1024, 1024, 1073741824);
            appendBytes = bounded(parameters, "appendBytes", 1024, 1, 1048576);
            minFreeBytes = bounded(parameters, "minFreeBytes", 1, 1, 1073741824);
            storageBytes.set(0);
            guard.registerCleanup(context, () -> storageRun = null);
        } else {
            throw new BizException("SCENARIO_OPERATION_MISMATCH", "Unsupported notification scenario");
        }
    }

    public synchronized void stop(ScenarioRunContext context, ScenarioRunGuard guard) {
        context.validateForRelease();
        guard.release(context);
        if (context.runId().equals(heapRun == null ? null : heapRun.runId())) heapRun = null;
        if (context.runId().equals(storageRun == null ? null : storageRun.runId())) storageRun = null;
    }

    public boolean shouldRetain() {
        ScenarioRunContext run = heapRun;
        if (run == null || !run.expiresAt().isAfter(Instant.now())) return false;
        long now = System.currentTimeMillis();
        long interval = 100;
        if (now - lastRetainedAt < interval) return false;
        lastRetainedAt = now;
        retainedObjects.add(new byte[retainedBytesPerNotification]);
        return true;
    }

    public String storageRunId() {
        ScenarioRunContext run = storageRun;
        return run != null && run.expiresAt().isAfter(Instant.now()) ? run.runId() : null;
    }

    public long reserveStorage(long payloadBytes) {
        if (storageRunId() == null) return 0;
        long now = System.currentTimeMillis();
        if (now - lastAppendedAt < 100) throw new BizException("STORAGE_APPEND_RATE_LIMIT", "Notification append rate is limited");
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

    public long storageBytes() {
        return storageBytes.get();
    }

    private long bounded(Map<String, Object> parameters, String name, long defaultValue, long min, long max) {
        Object value = parameters == null ? null : parameters.get(name);
        long result = value instanceof Number number ? number.longValue() : defaultValue;
        if (result < min || result > max) throw new BizException("INVALID_NOTIFICATION_PARAMETER", name + " is out of range");
        return result;
    }
}
