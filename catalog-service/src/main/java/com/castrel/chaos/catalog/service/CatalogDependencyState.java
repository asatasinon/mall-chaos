package com.castrel.chaos.catalog.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import org.springframework.stereotype.Component;

@Component
public class CatalogDependencyState {
    private volatile String activeRunId;

    public synchronized void start(OperationRunContext context, OperationRunGuard guard) {
        if (!guard.acceptStart(context)) {
            throw new BizException("STALE_OPERATION", "Operation fencing token was rejected");
        }
        if (activeRunId != null && !activeRunId.equals(context.runId())) {
            throw new BizException("OPERATION_ALREADY_ACTIVE", "Another catalog operation is active");
        }
        if (context.runId().equals(activeRunId)) return;
        activeRunId = context.runId();
        guard.registerCleanup(context, () -> stopIfOwned(context));
    }

    public synchronized void stop(OperationRunContext context, OperationRunGuard guard) {
        context.validateForRelease();
        guard.release(context);
        stopIfOwned(context);
    }

    public boolean isUnavailable() {
        return activeRunId != null;
    }

    private synchronized void stopIfOwned(OperationRunContext context) {
        if (context.runId().equals(activeRunId)) activeRunId = null;
    }
}
