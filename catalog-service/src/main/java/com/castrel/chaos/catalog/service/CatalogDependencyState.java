package com.castrel.chaos.catalog.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.springframework.stereotype.Component;

@Component
public class CatalogDependencyState {
    private volatile String activeRunId;

    public synchronized void start(ScenarioRunContext context, ScenarioRunGuard guard) {
        if (!guard.acceptStart(context)) {
            throw new BizException("STALE_SCENARIO_RUN", "Scenario run fencing token was rejected");
        }
        if (activeRunId != null && !activeRunId.equals(context.runId())) {
            throw new BizException("SCENARIO_RUN_ALREADY_ACTIVE", "Another catalog run is active");
        }
        if (context.runId().equals(activeRunId)) return;
        activeRunId = context.runId();
        guard.registerCleanup(context, () -> stopIfOwned(context));
    }

    public synchronized void stop(ScenarioRunContext context, ScenarioRunGuard guard) {
        context.validateForRelease();
        guard.release(context);
        stopIfOwned(context);
    }

    public boolean isUnavailable() {
        return activeRunId != null;
    }

    private synchronized void stopIfOwned(ScenarioRunContext context) {
        if (context.runId().equals(activeRunId)) activeRunId = null;
    }
}
