import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPrepareResponse, FaultRunReconciler } from './fault-run-reconciler';
import { toFaultRunAction } from '../lib/fault-run-action-repository';
import type { FaultRunExecutionRecord } from '../lib/fault-run-execution-repository';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import type { OwnedFaultRunDriver } from './fault-run-driver';

const run: FaultRunRecord = {
  faultRunId: '123e4567-e89b-12d3-a456-426614174000',
  scenario: 'BROWSE_REPORT_SQL',
  targetService: 'catalog-service',
  targetOperation: 'products-browse-report',
  state: 'ACTIVE',
  parameters: { durationSec: 60 },
  idempotencyKey: 'reconciler-test-key',
  fencingToken: 1,
  startedAt: '2026-09-21T01:00:00.000Z',
  expiresAt: '2026-09-21T02:00:00.000Z',
  stoppedAt: null,
  stopReason: null,
  recoveryResult: null,
  recoveryError: null,
  operatorAuditId: null,
  traceId: 'reconciler-test-trace',
  createdAt: '2026-09-21T01:00:00.000Z',
  updatedAt: '2026-09-21T01:00:00.000Z',
};

function execution(overrides: Partial<FaultRunExecutionRecord> = {}): FaultRunExecutionRecord {
  return {
    faultRunId: run.faultRunId,
    executionMode: 'TAKEOVER',
    ownerId: null,
    ownerEpoch: 0,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    leaseLostAt: null,
    reconciledAt: null,
    reconciliationState: 'IDLE',
    drainState: 'IDLE',
    drainDeadlineAt: null,
    lastAction: null,
    lastActionAt: null,
    lastErrorCode: null,
    createdAt: '2026-09-21T01:00:00.000Z',
    updatedAt: '2026-09-21T01:00:00.000Z',
    ...overrides,
  };
}

function driver(started: string[], stopped: string[]): OwnedFaultRunDriver {
  return {
    name: 'test-driver',
    drainOwner: 'REPORT_SCENARIO_WORKER',
    supports: () => true,
    start: async () => {
      started.push(run.faultRunId);
      return {
        stop: async () => {
          stopped.push(run.faultRunId);
          return { drained: true };
        },
      };
    },
  };
}

test('reconciler claims an initial owner and starts one supported driver', async () => {
  let current = execution();
  const started: string[] = [];
  const stopped: string[] = [];
  const claims: string[] = [];
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => current,
    claimExecution: async (input) => {
      if (current.ownerId !== null) return null;
      current = execution({
        ownerId: input.ownerId,
        ownerEpoch: 1,
        leaseExpiresAt: '2026-09-21T01:01:00.000Z',
        reconciliationState: input.reconciliationState,
        drainState: 'OWNED',
      });
      claims.push(input.ownerId);
      return current;
    },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [driver(started, stopped)],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER',
    ownerId: 'worker-a',
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    reconcileIntervalMs: 1_000,
  });

  await reconciler.scan();
  await reconciler.scan();

  assert.deepEqual(claims, ['worker-a']);
  assert.deepEqual(started, [run.faultRunId]);
  assert.deepEqual(reconciler.getOwnedRunIds(), [run.faultRunId]);
  await reconciler.stop();
  assert.deepEqual(stopped, [run.faultRunId]);
});

test('quiesce waits for scans but leaves owned drivers available to recovery', async () => {
  const started: string[] = [];
  const stopped: string[] = [];
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => execution(),
    claimExecution: async (input) => execution({
      ownerId: input.ownerId,
      ownerEpoch: 1,
      leaseExpiresAt: '2026-09-21T01:01:00.000Z',
      reconciliationState: input.reconciliationState,
      drainState: 'OWNED',
    }),
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [driver(started, stopped)],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER',
    ownerId: 'worker-a',
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    reconcileIntervalMs: 1_000,
  });

  await reconciler.scan();
  await reconciler.quiesce();

  assert.deepEqual(started, [run.faultRunId]);
  assert.deepEqual(stopped, []);
  assert.deepEqual(reconciler.getOwnedRunIds(), [run.faultRunId]);

  await reconciler.stop();
  assert.deepEqual(stopped, [run.faultRunId]);
});

test('recovery drain keeps the owner lease for RecoveryExecutor', async () => {
  let current = execution();
  const recoveryStopRequests: Array<() => void | Promise<void>> = [];
  let relinquishCalls = 0;
  const stopReasons: string[] = [];
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => current,
    claimExecution: async (input) => {
      current = execution({
        ownerId: input.ownerId,
        ownerEpoch: 1,
        leaseExpiresAt: '2026-09-21T01:01:00.000Z',
        reconciliationState: input.reconciliationState,
        drainState: 'OWNED',
      });
      return current;
    },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => {
      relinquishCalls++;
      return true;
    },
    appendEvent: async () => undefined,
    drainRegistry: {
      register: (_faultRunId, participant) => {
        recoveryStopRequests.push(participant.requestStop);
        return () => undefined;
      },
    },
    drivers: [{
      name: 'recovery-drain-test-driver',
      drainOwner: 'REPORT_SCENARIO_WORKER',
      supports: () => true,
      start: async () => ({
        stop: async ({ reason }) => {
          stopReasons.push(reason);
          return { drained: true };
        },
      }),
    }],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER',
    ownerId: 'worker-a',
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    reconcileIntervalMs: 1_000,
  });

  await reconciler.scan();
  assert.equal(recoveryStopRequests.length, 1);
  const requestRecoveryStop = recoveryStopRequests[0];
  assert.ok(requestRecoveryStop);
  await requestRecoveryStop();

  assert.deepEqual(stopReasons, ['RECOVERY']);
  assert.equal(relinquishCalls, 0);
  assert.equal(current.ownerId, 'worker-a');
  assert.deepEqual(reconciler.getOwnedRunIds(), []);
  await reconciler.stop();
});

test('shadow mode records stale takeover without claiming or starting a driver', async () => {
  const updates: string[] = [];
  let claims = 0;
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => execution({
      executionMode: 'SHADOW',
      ownerId: 'old-worker',
      ownerEpoch: 3,
      leaseExpiresAt: '2026-09-21T00:59:00.000Z',
    }),
    claimExecution: async () => {
      claims++;
      return null;
    },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async (input) => {
      updates.push(input.lastAction ?? '');
      return true;
    },
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER',
    ownerId: 'worker-new',
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    reconcileIntervalMs: 1_000,
  });

  await reconciler.scan();

  assert.equal(claims, 0);
  assert.deepEqual(updates, ['TAKEOVER_SHADOW_PLANNED']);
  assert.deepEqual(reconciler.getOwnedRunIds(), []);
});

test('run-frozen TAKEOVER mode claims a stale owner even when Worker is in SHADOW', async () => {
  const claims: Array<{ epoch: number; state: string }> = [];
  let current = execution({
    ownerId: 'old-worker',
    ownerEpoch: 3,
    leaseExpiresAt: '2026-09-21T00:59:00.000Z',
  });
  const started: string[] = [];
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => current,
    claimExecution: async (input) => {
      claims.push({ epoch: 4, state: input.reconciliationState });
      current = execution({
        ownerId: input.ownerId,
        ownerEpoch: 4,
        leaseExpiresAt: '2026-09-21T01:01:00.000Z',
        reconciliationState: input.reconciliationState,
        drainState: 'OWNED',
      });
      return current;
    },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [driver(started, [])],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'SHADOW',
    ownerId: 'new-worker',
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    reconcileIntervalMs: 1_000,
  });

  await reconciler.scan();

  assert.deepEqual(claims, [{ epoch: 4, state: 'TAKEN_OVER' }]);
  assert.deepEqual(started, [run.faultRunId]);
  await reconciler.stop();
});

test('heartbeat loss fences and drains the owned driver', async () => {
  let heartbeatCalls = 0;
  let markedLost = 0;
  let stopped = 0;
  let current = execution();
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => current,
    claimExecution: async (input) => {
      current = execution({
        ownerId: input.ownerId,
        ownerEpoch: 1,
        leaseExpiresAt: '2026-09-21T01:01:00.000Z',
        reconciliationState: 'OWNED',
        drainState: 'OWNED',
      });
      return current;
    },
    heartbeatExecution: async () => {
      heartbeatCalls++;
      return false;
    },
    markLeaseLost: async () => {
      markedLost++;
      return true;
    },
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [{
      name: 'heartbeat-test-driver',
      drainOwner: 'REPORT_SCENARIO_WORKER',
      supports: () => true,
      start: async () => ({
        stop: async () => {
          stopped++;
          return { drained: true };
        },
      }),
    }],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER',
    ownerId: 'worker-a',
    leaseTtlMs: 30_000,
    heartbeatMs: 5,
    reconcileIntervalMs: 1000,
  });

  await reconciler.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await reconciler.stop();

  assert.equal(heartbeatCalls > 0, true);
  assert.equal(markedLost, 1);
  assert.equal(stopped, 1);
  assert.deepEqual(reconciler.getOwnedRunIds(), []);
});

test('owned expired runs persist an expiry recovery command instead of releasing directly', async () => {
  let current = execution();
  let requested = 0;
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadRun: async () => ({ ...run, expiresAt: '2026-09-21T00:59:00.000Z' }),
    requestStop: async (input) => {
      requested++;
      assert.equal(input.reason, 'EXPIRED');
      assert.equal(input.drainTimeoutMs, 30_000);
      return null;
    },
    loadExecution: async () => current,
    claimExecution: async (input) => {
      current = execution({
        ownerId: input.ownerId,
        ownerEpoch: 1,
        leaseExpiresAt: '2026-09-21T01:01:00.000Z',
        reconciliationState: 'OWNED',
        drainState: 'OWNED',
      });
      return current;
    },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [driver([], [])],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER',
    ownerId: 'worker-a',
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    reconcileIntervalMs: 1_000,
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  await reconciler.scan();
  await reconciler.scan();

  assert.equal(requested, 1);
  await reconciler.stop();
});

const prepareResponse = {
  code: 200,
  data: { code: 200, data: { accepted: true, operation: run.targetOperation } },
};

test('prepare responses need a confirmed Gateway and target envelope', () => {
  assert.equal(classifyPrepareResponse(run, prepareResponse), 'CONFIRMED');
  assert.equal(classifyPrepareResponse(run, { code: 200, data: { accepted: true } }), 'UNKNOWN');
  assert.equal(classifyPrepareResponse(run, { code: 200, data: { code: 200, data: { accepted: false } } }),
    'UNKNOWN');
  assert.equal(classifyPrepareResponse(run, { code: 200, data: { code: 200, data: {
    accepted: true, operation: 'wrong-operation',
  } } }), 'UNKNOWN');
  assert.equal(classifyPrepareResponse(run, { code: 400, data: null }), 'REJECTED');
  assert.equal(classifyPrepareResponse(run, { code: 500, data: null }), 'UNKNOWN');
});

function prepareAction() {
  return toFaultRunAction({
    action_id: '223e4567-e89b-12d3-a456-426614174000',
    fault_run_id: run.faultRunId,
    action_type: 'PREPARE',
    attempt_no: 1,
    action_state: 'REQUESTED',
    requested_by: 'RECONCILER',
    request_idempotency_key: 'prepare-test-key',
    operator_audit_id: null,
    dispatch_owner_id: null,
    dispatch_owner_epoch: null,
    requested_at: run.createdAt,
    dispatch_started_at: null,
    completed_at: null,
    result_summary_json: null,
    error_code: null,
    created_at: run.createdAt,
    updated_at: run.createdAt,
  });
}

function creatingHarness(options: {
  scenario?: FaultRunRecord['scenario'];
  response?: unknown;
  throwPrepare?: boolean;
  action?: ReturnType<typeof prepareAction> | null;
  executionMode?: FaultRunExecutionRecord['executionMode'];
  optionMode?: 'SHADOW' | 'TAKEOVER';
  prepare?: (run: FaultRunRecord, signal?: AbortSignal) => Promise<unknown>;
  heartbeat?: () => Promise<boolean>;
  leaseTtlMs?: number;
  heartbeatMs?: number;
  reconcileIntervalMs?: number;
} = {}) {
  const calls: string[] = [];
  const creating = { ...run, state: 'CREATING' as const,
    scenario: options.scenario ?? run.scenario };
  let current = execution({
    executionMode: options.executionMode ?? 'TAKEOVER',
  });
  let action = options.action === undefined ? prepareAction() : options.action;
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [creating],
    loadExecution: async () => current,
    claimExecution: async (input) => {
      calls.push('claim-owner');
      current = execution({
        ownerId: input.ownerId,
        ownerEpoch: 1,
        executionMode: current.executionMode,
        leaseExpiresAt: '2026-09-21T01:01:00.000Z',
      });
      return current;
    },
    listActions: async () => action ? [action] : [],
    claimAction: async (input) => {
      calls.push('dispatch-boundary');
      assert.equal(current.ownerId, input.ownerId);
      assert.equal(current.ownerEpoch, input.ownerEpoch);
      if (!action || action.actionState !== 'REQUESTED') return null;
      action = { ...action, actionState: 'DISPATCHING',
        dispatchOwnerId: input.ownerId, dispatchOwnerEpoch: input.ownerEpoch };
      return action;
    },
    prepare: async (prepareRun, signal) => {
      calls.push('gateway-prepare');
      if (options.prepare) return options.prepare(prepareRun, signal);
      if (options.throwPrepare) throw new Error('raw target response');
      return options.response ?? prepareResponse;
    },
    activateCreating: async (input) => {
      calls.push('activate');
      assert.equal(input.ownerId, current.ownerId);
      assert.equal(input.ownerEpoch, current.ownerEpoch);
      if (input.prepareActionId) {
        assert.equal(action?.actionState, 'DISPATCHING');
        assert.equal(input.prepareActionId, action.actionId);
        action = { ...action, actionState: 'CONFIRMED' };
      } else {
        assert.equal(action, null);
      }
      return { ...creating, state: 'ACTIVE' };
    },
    markPrepareUnknown: async () => {
      calls.push('outcome-unknown');
      if (!action || action.actionState !== 'DISPATCHING') return false;
      action = { ...action, actionState: 'OUTCOME_UNKNOWN' };
      current = { ...current, reconciliationState: 'MANUAL_INTERVENTION_REQUIRED' };
      calls.push('ACTION_OUTCOME_UNKNOWN');
      return true;
    },
    rejectPrepare: async () => {
      calls.push('definitive-rejection');
      return true;
    },
    heartbeatExecution: async () => {
      if (options.heartbeat) return options.heartbeat();
      return true;
    },
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [{
      ...driver([], []),
      start: async ({ run: active }) => {
        assert.equal(active.state, 'ACTIVE');
        calls.push('driver-start');
        return { stop: async () => ({ drained: true }) };
      },
    }],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: options.optionMode ?? 'TAKEOVER',
    ownerId: 'worker-a',
    leaseTtlMs: options.leaseTtlMs ?? 30_000,
    heartbeatMs: options.heartbeatMs ?? 5_000,
    reconcileIntervalMs: options.reconcileIntervalMs ?? 1_000,
  });
  return { reconciler, calls, getAction: () => action, getExecution: () => current };
}

test('CREATING claims owner then PREPARE then confirms and activates before driver start', async () => {
  const harness = creatingHarness();
  await harness.reconciler.scan();
  assert.deepEqual(harness.calls,
    ['claim-owner', 'dispatch-boundary', 'gateway-prepare', 'activate', 'driver-start']);
  assert.equal(harness.getAction()?.actionState, 'CONFIRMED');
  await harness.reconciler.stop();
});

test('heartbeats an initial PREPARE and shutdown aborts and awaits its request', async () => {
  let markPrepareStarted!: () => void;
  const prepareStarted = new Promise<void>((resolve) => {
    markPrepareStarted = resolve;
  });
  let aborted = false;
  let heartbeatCount = 0;
  const harness = creatingHarness({
    leaseTtlMs: 100,
    heartbeatMs: 5,
    reconcileIntervalMs: 1_000,
    heartbeat: async () => {
      heartbeatCount++;
      return true;
    },
    prepare: async (_run, signal) => {
      markPrepareStarted();
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          aborted = true;
          reject(new Error('PREPARE_ABORTED'));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  });

  const start = harness.reconciler.start();
  await prepareStarted;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(heartbeatCount > 0);

  await harness.reconciler.stop();
  await start;
  assert.equal(aborted, true);
  assert.equal(harness.getAction()?.actionState, 'OUTCOME_UNKNOWN');
  assert.deepEqual(harness.reconciler.getOwnedRunIds(), []);
});

test('quiesce timeout fences an unresponsive PREPARE and clears its heartbeat', async () => {
  let markPrepareStarted!: () => void;
  const prepareStarted = new Promise<void>((resolve) => {
    markPrepareStarted = resolve;
  });
  let resolvePrepare!: (response: unknown) => void;
  const response = new Promise<unknown>((resolve) => {
    resolvePrepare = resolve;
  });
  let signal: AbortSignal | undefined;
  let heartbeatCount = 0;
  const harness = creatingHarness({
    leaseTtlMs: 40,
    heartbeatMs: 5,
    heartbeat: async () => {
      heartbeatCount++;
      return true;
    },
    prepare: async (_run, requestSignal) => {
      signal = requestSignal;
      markPrepareStarted();
      return response;
    },
  });

  const start = harness.reconciler.start();
  await prepareStarted;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(heartbeatCount > 0);

  await assert.rejects(harness.reconciler.stop(), /RECONCILER_QUIESCE_TIMEOUT/);
  assert.equal(signal?.aborted, true);
  const heartbeatsAtStop = heartbeatCount;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(heartbeatCount, heartbeatsAtStop);

  resolvePrepare(prepareResponse);
  await start;
  assert.equal(harness.getAction()?.actionState, 'OUTCOME_UNKNOWN');
});

test('catalog no-prepare CREATING activates without a fabricated target action', async () => {
  const harness = creatingHarness({ scenario: 'BROWSE_SURGE', action: null });
  await harness.reconciler.scan();
  assert.deepEqual(harness.calls, ['claim-owner', 'activate', 'driver-start']);
  await harness.reconciler.stop();
});

test('ambiguous PREPARE stays unknown and never dispatches a second time', async () => {
  const harness = creatingHarness({ throwPrepare: true });
  await harness.reconciler.scan();
  await harness.reconciler.scan();
  assert.deepEqual(harness.calls,
    ['claim-owner', 'dispatch-boundary', 'gateway-prepare', 'outcome-unknown', 'ACTION_OUTCOME_UNKNOWN']);
  assert.equal(harness.getAction()?.actionState, 'OUTCOME_UNKNOWN');
  assert.equal(harness.getExecution().reconciliationState, 'MANUAL_INTERVENTION_REQUIRED');
  assert.deepEqual(harness.reconciler.getOwnedRunIds(), []);
});

test('envelope rejection is the only definitive pre-dispatch failure', async () => {
  const harness = creatingHarness({ response: { code: 400, data: null } });
  await harness.reconciler.scan();
  assert.deepEqual(harness.calls,
    ['claim-owner', 'dispatch-boundary', 'gateway-prepare', 'definitive-rejection']);
});

test('expired CREATING never claims or dispatches', async () => {
  const harness = creatingHarness();
  // The run fixture expires at 02:00; the scan below uses a separate expired candidate.
  const expired = { ...run, state: 'CREATING' as const, expiresAt: '2026-09-21T00:59:00.000Z' };
  const calls: string[] = [];
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [expired],
    loadExecution: async () => execution(),
    claimExecution: async () => { calls.push('claim'); return null; },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    requestStop: async () => { calls.push('stop-request'); return null; },
    drivers: [driver([], [])],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER', ownerId: 'worker-a', leaseTtlMs: 30_000,
    heartbeatMs: 5_000, reconcileIntervalMs: 1_000,
  });
  await reconciler.scan();
  assert.deepEqual(calls, ['stop-request']);
  assert.deepEqual(harness.calls, []);
});

test('stale dispatch is marked unknown before any new owner claim', async () => {
  const calls: string[] = [];
  const action = {
    ...prepareAction(),
    actionState: 'DISPATCHING' as const,
    dispatchOwnerId: 'old-worker',
    dispatchOwnerEpoch: 3,
  };
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [{ ...run, state: 'CREATING' }],
    loadExecution: async () => execution({
      ownerId: 'old-worker', ownerEpoch: 3,
      leaseExpiresAt: '2026-09-21T00:59:00.000Z',
    }),
    listActions: async () => [action],
    markStaleActionUnknown: async (input) => {
      assert.equal(input.dispatchOwnerEpoch, 3);
      calls.push('stale-unknown');
      return true;
    },
    claimExecution: async () => { calls.push('claim'); return null; },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [driver([], [])],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER', ownerId: 'worker-new', leaseTtlMs: 30_000,
    heartbeatMs: 5_000, reconcileIntervalMs: 1_000,
  });
  await reconciler.scan();
  assert.deepEqual(calls, ['stale-unknown']);
});
