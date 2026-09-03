package com.castrel.chaos.psp;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunContext;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;

@Component
public class PspOutcomeState {
    private final ScenarioRunGuard runGuard;
    private volatile ScenarioRunContext activeRun;
    private volatile String outcome = "AUTHORIZED";
    private int effectPercentage = 100;
    private long authorizationCount;

    public PspOutcomeState(ScenarioRunGuard runGuard) {
        this.runGuard = runGuard;
    }

    public synchronized void prepare(ScenarioRunContext context, Map<String, Object> parameters) {
        context.validate(Instant.now());
        if (!runGuard.acceptStart(context)) throw new BizException("STALE_SCENARIO_RUN", "Scenario token was rejected");
        if (activeRun != null && !activeRun.runId().equals(context.runId())) {
            throw new BizException("SCENARIO_RUN_ALREADY_ACTIVE", "Another provider operation is active");
        }
        if (activeRun != null && activeRun.runId().equals(context.runId())) return;
        Object configured = parameters == null ? null : parameters.get("providerOutcome");
        if (!(configured instanceof String value)
                || !("AUTHORIZED".equals(value) || "DECLINED".equals(value) || "TIMEOUT".equals(value))) {
            throw new BizException("INVALID_PROVIDER_OUTCOME", "providerOutcome must be AUTHORIZED, DECLINED or TIMEOUT");
        }
        int configuredPercentage = parseEffectPercentage(parameters);
        activeRun = context;
        outcome = value;
        effectPercentage = configuredPercentage;
        authorizationCount = 0;
        runGuard.registerCleanup(context, () -> clear(context));
    }

    public synchronized String authorize() {
        if (activeRun == null || !activeRun.expiresAt().isAfter(Instant.now())) return "AUTHORIZED";
        authorizationCount++;
        long previousEffectQuota = ((authorizationCount - 1) * effectPercentage) / 100;
        long currentEffectQuota = (authorizationCount * effectPercentage) / 100;
        return currentEffectQuota > previousEffectQuota ? outcome : "AUTHORIZED";
    }

    public synchronized void release(ScenarioRunContext context) {
        context.validateForRelease();
        runGuard.release(context);
        clear(context);
    }

    private synchronized void clear(ScenarioRunContext context) {
        if (activeRun != null && activeRun.runId().equals(context.runId())) {
            activeRun = null;
            outcome = "AUTHORIZED";
            effectPercentage = 100;
            authorizationCount = 0;
        }
    }

    private int parseEffectPercentage(Map<String, Object> parameters) {
        Object configured = parameters == null ? null : parameters.get("effectPercentage");
        if (configured == null) return 100;
        if (!(configured instanceof Number number)) {
            throw new BizException("INVALID_EFFECT_PERCENTAGE", "effectPercentage must be an integer between 0 and 100");
        }
        double value = number.doubleValue();
        if (!Double.isFinite(value) || value != Math.rint(value) || value < 0 || value > 100) {
            throw new BizException("INVALID_EFFECT_PERCENTAGE", "effectPercentage must be an integer between 0 and 100");
        }
        return number.intValue();
    }
}