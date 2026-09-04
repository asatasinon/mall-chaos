package com.castrel.chaos.notification.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
public class NotificationRetentionState {
    private final CopyOnWriteArrayList<byte[]> retainedObjects = new CopyOnWriteArrayList<>();
    private final NotificationStorageGrowthWriter storageWriter;
    private volatile OperationRunContext retentionRun;
    private volatile OperationRunContext storageRun;
    private volatile long requestIntervalMs = 100;
    private volatile int retainedBytesPerNotification = 1024 * 1024;
    private volatile long totalStorageBytes = 10L * 1024 * 1024 * 1024;
    private volatile long appendBytes = 16L * 1024 * 1024;
    private volatile long minFreeBytes = 1L * 1024 * 1024;
    private volatile long lastRetainedAt;
    private volatile long lastAppendedAt;

    public NotificationRetentionState(NotificationStorageGrowthWriter storageWriter) {
        this.storageWriter = storageWriter;
    }

    public synchronized void prepareRetention(OperationRunContext context,
                                               Map<String, Object> parameters,
                                               OperationRunGuard guard) {
        validateStart(context, guard);
        ensureAvailable(context);
        if (retentionRun != null && retentionRun.runId().equals(context.runId())) return;
        retentionRun = context;
        requestIntervalMs = bounded(parameters, "requestIntervalMs", 100, 0, 60000);
        retainedBytesPerNotification = (int) bounded(parameters, "retainedBytesPerNotification",
                1024 * 1024, 1024, 10L * 1024 * 1024);
        guard.registerCleanup(context, () -> clearRetention(context));
    }

    public synchronized void prepareStorage(OperationRunContext context,
                                             Map<String, Object> parameters,
                                             OperationRunGuard guard) {
        validateStart(context, guard);
        ensureAvailable(context);
        if (storageRun != null && storageRun.runId().equals(context.runId())) return;
        requestIntervalMs = bounded(parameters, "requestIntervalMs", 100, 0, 60000);
        totalStorageBytes = bounded(parameters, "totalBytes", 10L * 1024 * 1024 * 1024, 1024, Long.MAX_VALUE);
        appendBytes = bounded(parameters, "appendBytes", 16L * 1024 * 1024, 1, 64L * 1024 * 1024);
        minFreeBytes = bounded(parameters, "minFreeBytes", 1L * 1024 * 1024, 1, 1073741824);
        storageWriter.prepare(context.runId());
        storageRun = context;
        lastAppendedAt = 0;
        guard.registerCleanup(context, () -> clearStorage(context));
    }

    public synchronized void release(OperationRunContext context, OperationRunGuard guard) {
        context.validateForRelease();
        guard.release(context);
        clearRetention(context);
        clearStorage(context);
    }

    public synchronized void stopAllStorageOperations(OperationRunGuard guard) {
        if (storageRun != null) {
            guard.release(storageRun);
            storageRun = null;
        }
    }

    public boolean shouldRetain() {
        OperationRunContext run = retentionRun;
        if (run == null || !run.expiresAt().isAfter(Instant.now())) return false;
        long now = System.currentTimeMillis();
        if (now - lastRetainedAt < requestIntervalMs) return false;
        lastRetainedAt = now;
        retainedObjects.add(new byte[retainedBytesPerNotification]);
        return true;
    }

    public synchronized long appendStorage(OperationRunContext context, OperationRunGuard guard) {
        context.validate(Instant.now());
        if (!guard.isAccepted(context)) {
            throw new BizException("STALE_OPERATION", "Operation token was rejected");
        }
        OperationRunContext run = storageRun;
        if (run == null || !run.runId().equals(context.runId())
                || run.fencingToken() != context.fencingToken()) {
            throw new BizException("STALE_OPERATION", "Operation token was rejected");
        }
        long now = System.currentTimeMillis();
        if (now - lastAppendedAt < requestIntervalMs) {
            throw new BizException("STORAGE_APPEND_RATE_LIMIT", "Notification append rate is limited");
        }
        long next = storageWriter.append(run.runId(), appendBytes, totalStorageBytes, minFreeBytes);
        lastAppendedAt = now;
        return next;
    }

    public synchronized long cleanupStorage(OperationRunContext context, OperationRunGuard guard) {
        context.validateForCleanup();
        guard.release(context);
        clearStorage(context);
        return storageWriter.delete(context.runId());
    }

    public synchronized long cleanupAllStorage(OperationRunGuard guard) {
        stopAllStorageOperations(guard);
        return storageWriter.deleteAll();
    }

    public int retainedEntries() {
        return retainedObjects.size();
    }

    private void validateStart(OperationRunContext context, OperationRunGuard guard) {
        context.validate(Instant.now());
        if (!guard.acceptStart(context)) {
            throw new BizException("STALE_OPERATION", "Operation token was rejected");
        }
    }

    private void ensureAvailable(OperationRunContext context) {
        if ((retentionRun != null && !retentionRun.runId().equals(context.runId()))
                || (storageRun != null && !storageRun.runId().equals(context.runId()))) {
            throw new BizException("OPERATION_ALREADY_ACTIVE", "Another notification operation is active");
        }
    }

    private void clearRetention(OperationRunContext context) {
        if (retentionRun != null && retentionRun.runId().equals(context.runId())) retentionRun = null;
    }

    private void clearStorage(OperationRunContext context) {
        if (storageRun != null && storageRun.runId().equals(context.runId())) storageRun = null;
    }

    private long bounded(Map<String, Object> parameters, String name, long defaultValue, long min, long max) {
        Object value = parameters == null ? null : parameters.get(name);
        long result = value instanceof Number number ? number.longValue() : defaultValue;
        if (result < min || result > max) {
            throw new BizException("INVALID_NOTIFICATION_PARAMETER", name + " is out of range");
        }
        return result;
    }
}
