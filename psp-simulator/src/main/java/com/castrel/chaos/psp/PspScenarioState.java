package com.castrel.chaos.psp;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;

@Component
public class PspScenarioState {
    private final ScenarioRunGuard runGuard;
    private volatile ScenarioRunContext activeRun;
    private volatile String outcome = "AUTHORIZED";

    public PspScenarioState(ScenarioRunGuard runGuard) {
        this.runGuard = runGuard;
    }

    public synchronized void start(ScenarioRunContext context, Map<String, Object> parameters) {
        context.validate(Instant.now());
        if (!runGuard.acceptStart(context)) throw new BizException("STALE_SCENARIO_RUN", "Scenario token was rejected");
        if (activeRun != null && !activeRun.runId().equals(context.runId())) {
            throw new BizException("SCENARIO_RUN_ALREADY_ACTIVE", "Another provider run is active");
        }
        if (activeRun != null && activeRun.runId().equals(context.runId())) return;
        Object configured = parameters == null ? null : parameters.get("providerOutcome");
        if (!(configured instanceof String value)
                || !("AUTHORIZED".equals(value) || "DECLINED".equals(value) || "TIMEOUT".equals(value))) {
            throw new BizException("INVALID_PROVIDER_OUTCOME", "providerOutcome must be AUTHORIZED, DECLINED or TIMEOUT");
        }
        activeRun = context;
        outcome = value;
        runGuard.registerCleanup(context, () -> clear(context));
    }

    public String authorize(String runId, long fencingToken) {
        ScenarioRunContext run = activeRun;
        if (run == null) return "AUTHORIZED";
        if (runId == null || !run.runId().equals(runId) || run.fencingToken() != fencingToken) {
            return "AUTHORIZED";
        }
        return run.expiresAt().isAfter(Instant.now()) ? outcome : "AUTHORIZED";
    }

    public synchronized void stop(ScenarioRunContext context) {
        context.validateForRelease();
        runGuard.release(context);
        clear(context);
    }

    private synchronized void clear(ScenarioRunContext context) {
        if (activeRun != null && activeRun.runId().equals(context.runId())) {
            activeRun = null;
            outcome = "AUTHORIZED";
        }
    }
}
