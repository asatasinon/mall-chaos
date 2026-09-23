import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeFaultRunRecoveryStep,
  planFaultRunStop,
  startFaultRunManualCleanup,
  type CompleteFaultRunManualCleanupInput,
  type CompleteFaultRunRecoveryInput,
  type FaultRunCommandResult,
  type FaultRunRecord,
  type RecordFaultRunRecoveryStepInput,
  type RequestFaultRunStopInput,
} from '../lib/fault-run-repository';
import type { FaultRunActionRecord } from '../lib/fault-run-action-repository';
import type { FaultRunExecutionRecord } from '../lib/fault-run-execution-repository';
import {
  createInitialFaultRunRecoveryProjection,
  parseFaultRunRecoveryProjection,
  type FaultRunRecoveryProjection,
} from '../lib/fault-run-recovery';
import {
  FaultRunRecoveryExecutor,
  type FaultRunRecoveryDrainController,
  type FaultRunRecoveryDrainResult,
  type FaultRunRecoveryStore,
} from './fault-run-recovery-executor';
import { FaultRunDrainRegistry } from './fault-run-drain-registry';

const runId = '123e4567-e89b-12d3-a456-426614174000';
const now = new Date('2026-09-18T00:00:00.000Z');
const drainAt = new Date('2026-09-18T00:00:30.000Z');
const recoveryAt = new Date('2026-09-18T00:01:00.000Z');

function createRun(overrides: Partial<FaultRunRecord> = {}): FaultRunRecord {
  return {
    faultRunId: runId,
    scenario: 'BROWSE_REPORT_SQL',
    targetService: 'catalog-service',
    targetOperation: 'products-browse-report',
    state: 'RECOVERING',
    parameters: { durationSec: 60 },
    idempotencyKey: 'create-request-001',
    fencingToken: 1,
    startedAt: now.toISOString(),
    expiresAt: '2026-09-18T00:10:00.000Z',
    stoppedAt: null,
    stopReason: 'MANUAL',
    recoveryResult: initialProjection(),
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-1',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function createManualCleanupRequiredProjection(recoveryDeadlineAt = recoveryAt): FaultRunRecoveryProjection {
  const effectiveDrainDeadline = recoveryDeadlineAt.getTime() < drainAt.getTime()
    ? recoveryDeadlineAt
    : drainAt;
  const initial = createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt: now,
    drainDeadlineAt: effectiveDrainDeadline,
    recoveryDeadlineAt,
  });
  return {
    ...initial,
    phase: 'MANUAL_CLEANUP_REQUIRED',
    outcome: 'MANUAL_CLEANUP_REQUIRED',
    drain: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      participantKinds: ['RUNNER'],
    },
    release: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
    },
    cleanup: {
      status: 'MANUAL_REQUIRED',
      attempt: 0,
      errorCode: 'MANUAL_CLEANUP_REQUIRED',
    },
    residuals: [{
      kind: 'MANUAL_CLEANUP_PENDING',
      responsibility: 'OPERATOR',
      nextAction: 'COMPLETE_MANUAL_CLEANUP',
    }],
    lastError: {
      stage: 'CLEANUP',
      code: 'MANUAL_CLEANUP_REQUIRED',
      retryable: false,
    },
  };
}

function initialProjection(): FaultRunRecoveryProjection {
  return createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt: now,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
  });
}

function createExecution(): FaultRunExecutionRecord {
  return {
    faultRunId: runId,
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
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function createAction(
  actionType: FaultRunActionRecord['actionType'],
  requestIdempotencyKey: string,
  actionState: FaultRunActionRecord['actionState'] = 'REQUESTED',
): FaultRunActionRecord {
  return {
    actionId: `action-${requestIdempotencyKey}`,
    faultRunId: runId,
    actionType,
    attemptNo: 1,
    actionState,
    requestedBy: actionType === 'RELEASE' ? 'RECONCILER' : 'OPERATOR',
    requestIdempotencyKey,
    operatorAuditId: null,
    dispatchOwnerId: null,
    dispatchOwnerEpoch: null,
    requestedAt: now.toISOString(),
    dispatchStartedAt: null,
    completedAt: null,
    resultSummary: null,
    errorCode: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function isTerminalTestRun(state: FaultRunRecord['state']): boolean {
  return state === 'RECOVERED' || state === 'STOPPED'
    || state === 'FAILED' || state === 'SERVICE_UNAVAILABLE';
}

class MemoryRecoveryStore implements FaultRunRecoveryStore {
  events: string[] = [];
  requestStops: RequestFaultRunStopInput[] = [];
  completeCalls: CompleteFaultRunRecoveryInput[] = [];
  completeManualCleanupCalls: CompleteFaultRunManualCleanupInput[] = [];
  failEvent: string | null = null;
  actions: FaultRunActionRecord[] = [];
  execution: FaultRunExecutionRecord | null;

  constructor(public run: FaultRunRecord | null) {
    this.execution = run?.execution ?? null;
  }

  async load() {
    return this.currentRun();
  }

  async listRecovering() {
    const run = this.currentRun();
    return run?.state === 'RECOVERING' ? [run] : [];
  }

  async listExpiredRunnable() {
    const run = this.currentRun();
    return run?.state === 'ACTIVE' && run.expiresAt <= now.toISOString() ? [run] : [];
  }

  async listPendingTerminalCleanup() {
    const run = this.currentRun();
    return run && isTerminalTestRun(run.state)
      && this.actions.some((action) => action.actionType === 'CLEANUP'
        && ['REQUESTED', 'DISPATCHING'].includes(action.actionState))
      ? [run]
      : [];
  }

  async requestStop(input: RequestFaultRunStopInput): Promise<FaultRunCommandResult | null> {
    this.requestStops.push(input);
    if (!this.run || this.run.faultRunId !== input.faultRunId) return null;
    const plan = planFaultRunStop(this.run, {
      reason: input.reason,
      requestedAt: input.now ?? now,
      drainTimeoutMs: input.drainTimeoutMs,
      recoveryTimeoutMs: input.recoveryTimeoutMs,
    });
    if (!plan.projection) throw new Error('TEST_STOP_PLAN_MISSING');
    if (plan.disposition === 'ACCEPTED') {
      this.run = {
        ...this.run,
        state: 'RECOVERING',
        stopReason: plan.projection.stop.reason,
        recoveryResult: plan.projection,
      };
      this.events.push('STOP_REQUESTED');
    }
    return {
      disposition: plan.disposition,
      run: this.currentRun()!,
      recovery: parseFaultRunRecoveryProjection(this.run.recoveryResult),
    };
  }

  async recordStep(input: RecordFaultRunRecoveryStepInput) {
    if (!this.run) return null;
    if (!this.ownerMatches(input.faultRunId, input.owner)) return null;
    if (this.failEvent === input.eventType) throw new Error('RECOVERY_STEP_PERSISTENCE_FAILED');
    const current = parseFaultRunRecoveryProjection(this.run.recoveryResult);
    if (current.kind !== 'SAFE_RUNTIME_V1') throw new Error('TEST_PROJECTION_INVALID');
    assert.equal(input.expectedAttempt, current.projection.stop.attempt);
    this.run = {
      ...this.run,
      recoveryResult: mergeFaultRunRecoveryStep(current.projection, input.mutation),
    };
    this.events.push(input.eventType);
    return this.run;
  }

  async complete(input: CompleteFaultRunRecoveryInput) {
    if (!this.run) return null;
    if (!this.ownerMatches(input.faultRunId, input.owner)) return null;
    this.completeCalls.push(input);
    this.events.push(input.eventType);
    return this.run;
  }

  async completeManualCleanup(input: CompleteFaultRunManualCleanupInput) {
    if (!this.run) return null;
    if (this.failEvent === input.eventType) throw new Error('MANUAL_CLEANUP_PERSISTENCE_FAILED');
    this.completeManualCleanupCalls.push(input);
    this.events.push(input.eventType);
    this.run = {
      ...this.run,
      recoveryResult: input.projection,
      recoveryError: input.projection.lastError?.code ?? null,
    };
    return this.run;
  }

  async loadExecution() {
    return this.execution;
  }

  async claimExecution(input: {
    faultRunId: string;
    executionMode: FaultRunExecutionRecord['executionMode'];
    ownerId: string;
    leaseTtlMs: number;
    reconciliationState: 'OWNED' | 'TAKEN_OVER';
    lastAction: 'OWNER_LEASE_ACQUIRED' | 'OWNER_TAKEOVER_COMPLETED';
  }) {
    if (!this.execution || input.faultRunId !== this.execution.faultRunId) return null;
    const stale = this.execution.ownerId !== null
      && this.execution.leaseExpiresAt !== null
      && Date.parse(this.execution.leaseExpiresAt) <= now.getTime();
    if (this.execution.ownerId !== null
      && !(this.execution.executionMode === 'TAKEOVER' && stale)) return null;
    this.execution = {
      ...this.execution,
      ownerId: input.ownerId,
      ownerEpoch: this.execution.ownerEpoch + 1,
      leaseAcquiredAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + input.leaseTtlMs).toISOString(),
      lastHeartbeatAt: now.toISOString(),
      reconciliationState: input.reconciliationState,
      drainState: this.run && isTerminalTestRun(this.run.state)
        ? this.execution.drainState
        : 'OWNED',
      lastAction: input.lastAction,
    };
    return this.execution;
  }

  async heartbeatExecution(input: {
    faultRunId: string;
    ownerId: string;
    ownerEpoch: number;
    leaseTtlMs: number;
  }) {
    if (!this.ownerMatches(input.faultRunId, input)) return false;
    this.execution = {
      ...this.execution!,
      leaseExpiresAt: new Date(now.getTime() + input.leaseTtlMs).toISOString(),
      lastHeartbeatAt: now.toISOString(),
    };
    return true;
  }

  async markLeaseLost() {
    return false;
  }

  async updateExecution(input: {
    faultRunId: string;
    ownerId: string;
    ownerEpoch: number;
    drainState?: FaultRunExecutionRecord['drainState'];
    lastAction?: string | null;
    lastErrorCode?: string | null;
  }) {
    if (!this.ownerMatches(input.faultRunId, input)) return false;
    this.execution = {
      ...this.execution!,
      ...(input.drainState === undefined ? {} : { drainState: input.drainState }),
      ...(input.lastAction === undefined ? {} : { lastAction: input.lastAction }),
      ...(input.lastErrorCode === undefined ? {} : { lastErrorCode: input.lastErrorCode }),
    };
    return true;
  }

  async relinquishExecution(input: { faultRunId: string; ownerId: string; ownerEpoch: number }) {
    if (!this.ownerMatches(input.faultRunId, input)
      || !['DRAINED', 'NOT_APPLICABLE'].includes(this.execution?.drainState ?? '')) return false;
    this.execution = {
      ...this.execution!,
      ownerId: null,
      leaseExpiresAt: now.toISOString(),
      reconciliationState: 'IDLE',
    };
    return true;
  }

  async listActions() {
    return this.actions;
  }

  async claimAction(input: { actionId: string; ownerId: string; ownerEpoch: number }) {
    const action = this.actions.find((candidate) => candidate.actionId === input.actionId);
    if (!action || action.actionState !== 'REQUESTED' || !this.ownerMatches(runId, input)) return null;
    Object.assign(action, {
      actionState: 'DISPATCHING',
      dispatchOwnerId: input.ownerId,
      dispatchOwnerEpoch: input.ownerEpoch,
      dispatchStartedAt: now.toISOString(),
    });
    return action;
  }

  async markStaleActionUnknown(input: {
    actionId: string;
    dispatchOwnerId: string;
    dispatchOwnerEpoch: number;
  }) {
    const action = this.actions.find((candidate) => candidate.actionId === input.actionId);
    if (!action || action.actionState !== 'DISPATCHING'
      || action.dispatchOwnerId !== input.dispatchOwnerId
      || action.dispatchOwnerEpoch !== input.dispatchOwnerEpoch) return false;
    Object.assign(action, {
      actionState: 'OUTCOME_UNKNOWN',
      completedAt: now.toISOString(),
      errorCode: 'OWNER_LEASE_EXPIRED',
    });
    if (this.execution) this.execution.reconciliationState = 'MANUAL_INTERVENTION_REQUIRED';
    this.events.push('ACTION_OUTCOME_UNKNOWN');
    return true;
  }

  async markActionUnknown(input: {
    actionId: string;
    actionType: 'RELEASE' | 'CLEANUP';
    ownerId: string;
    ownerEpoch: number;
    errorCode: string;
  }) {
    const action = this.actions.find((candidate) => candidate.actionId === input.actionId);
    if (!action || action.actionType !== input.actionType
      || action.actionState !== 'DISPATCHING'
      || !this.ownerMatches(runId, input)) return false;
    Object.assign(action, {
      actionState: 'OUTCOME_UNKNOWN',
      completedAt: now.toISOString(),
      errorCode: input.errorCode,
    });
    if (this.execution) this.execution.reconciliationState = 'MANUAL_INTERVENTION_REQUIRED';
    this.events.push('ACTION_OUTCOME_UNKNOWN');
    return true;
  }

  async startOwnedRelease(input: Parameters<NonNullable<FaultRunRecoveryStore['startOwnedRelease']>>[0]) {
    if (!this.run || !this.ownerMatches(input.faultRunId, input)) return null;
    const current = parseFaultRunRecoveryProjection(this.run.recoveryResult);
    if (current.kind !== 'SAFE_RUNTIME_V1') return null;
    const projection = mergeFaultRunRecoveryStep(current.projection, input.mutation);
    const action = createAction('RELEASE', input.requestIdempotencyKey);
    action.attemptNo = input.expectedAttempt;
    this.actions.push(action);
    this.run = { ...this.run, recoveryResult: projection };
    this.events.push('RELEASE_STARTED');
    return { run: this.currentRun()!, actionId: action.actionId };
  }

  async settleOwnedRecoveryAction(
    input: Parameters<NonNullable<FaultRunRecoveryStore['settleOwnedRecoveryAction']>>[0],
  ) {
    if (!this.run || !this.ownerMatches(input.faultRunId, input)) return null;
    const action = this.actions.find((candidate) => candidate.actionId === input.actionId);
    if (!action || action.actionState !== 'DISPATCHING'
      || action.dispatchOwnerId !== input.ownerId
      || action.dispatchOwnerEpoch !== input.ownerEpoch) return null;
    const current = parseFaultRunRecoveryProjection(this.run.recoveryResult);
    if (current.kind !== 'SAFE_RUNTIME_V1') return null;
    const projection = input.actionType === 'CLEANUP'
      ? {
          ...current.projection,
          phase: input.mutation.phase,
          outcome: input.mutation.outcome,
          cleanup: input.mutation.step as FaultRunRecoveryProjection['cleanup'],
          residuals: input.mutation.residuals,
          ...(input.mutation.lastError === undefined
            ? {}
            : { lastError: input.mutation.lastError }),
        }
      : mergeFaultRunRecoveryStep(current.projection, input.mutation);
    Object.assign(action, {
      actionState: input.actionState,
      resultSummary: input.resultSummary ?? null,
      errorCode: input.errorCode ?? null,
      completedAt: now.toISOString(),
    });
    this.run = {
      ...this.run,
      recoveryResult: projection,
      recoveryError: projection.lastError?.code ?? null,
    };
    this.events.push(input.eventType);
    return this.currentRun();
  }

  async finishOwnedAction(
    input: Parameters<NonNullable<FaultRunRecoveryStore['finishOwnedAction']>>[0],
  ) {
    if (!this.run || !this.ownerMatches(input.faultRunId, input)) return false;
    const action = this.actions.find((candidate) => candidate.actionId === input.actionId);
    if (!action || action.actionState !== 'DISPATCHING'
      || action.dispatchOwnerId !== input.ownerId
      || action.dispatchOwnerEpoch !== input.ownerEpoch) return false;
    Object.assign(action, {
      actionState: input.actionState,
      resultSummary: input.resultSummary ?? null,
      errorCode: input.errorCode ?? null,
      completedAt: now.toISOString(),
    });
    this.events.push(input.eventType);
    return true;
  }

  async appendEvent(_faultRunId: string, eventType: string) {
    this.events.push(eventType);
  }

  private currentRun(): FaultRunRecord | null {
    if (!this.run) return null;
    return this.execution ? { ...this.run, execution: this.execution } : this.run;
  }

  private ownerMatches(
    faultRunId: string,
    owner?: { ownerId: string; ownerEpoch: number },
  ): boolean {
    return !owner || (this.execution?.faultRunId === faultRunId
      && this.execution.ownerId === owner.ownerId
      && this.execution.ownerEpoch === owner.ownerEpoch
      && this.execution.leaseExpiresAt !== null
      && Date.parse(this.execution.leaseExpiresAt) > now.getTime()
      && this.execution.reconciliationState !== 'MANUAL_INTERVENTION_REQUIRED');
  }
}

class MemoryDrainController implements FaultRunRecoveryDrainController {
  calls = 0;

  constructor(private readonly result: FaultRunRecoveryDrainResult) {}

  async closeGate() {
    return { kind: 'CLOSED' as const, participant: this.result.participant };
  }

  async drain(): Promise<FaultRunRecoveryDrainResult> {
    this.calls++;
    return this.result;
  }
}

function createExecutor(
  store: MemoryRecoveryStore,
  drain: FaultRunRecoveryDrainController,
  stop: (run: FaultRunRecord, signal?: AbortSignal) => Promise<unknown> = async () => ({}),
  cleanup: (run: FaultRunRecord, signal?: AbortSignal) => Promise<unknown> = async () => ({}),
) {
  return new FaultRunRecoveryExecutor(store, drain, { stop, cleanup }, {
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
    now: () => now,
    logger: { info() {}, warn() {} },
  });
}

function createOwnedExecutor(
  store: MemoryRecoveryStore,
  stop: (run: FaultRunRecord, signal?: AbortSignal) => Promise<unknown> = async () => ({
    code: 200,
    data: { code: 200, data: { released: true, operation: 'products-browse-report' } },
  }),
  cleanup: (run: FaultRunRecord, signal?: AbortSignal) => Promise<unknown> = async () => ({
    code: 200,
    data: { code: 200, data: { cleaned: true, operation: 'notification-storage' } },
  }),
) {
  const participant = store.run?.scenario === 'NOTIFICATION_STORAGE_APPEND' ? 'RUNNER' : 'REPORT';
  return new FaultRunRecoveryExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant }),
    { stop, cleanup },
    {
      drainTimeoutMs: 30_000,
      recoveryTimeoutMs: 60_000,
      ownerId: 'recovery-owner',
      leaseTtlMs: 30_000,
      heartbeatMs: 10_000,
      ownershipRequired: true,
      now: () => now,
      logger: { info() {}, warn() {} },
    },
  );
}

function recoveryOf(store: MemoryRecoveryStore): FaultRunRecoveryProjection {
  const result = parseFaultRunRecoveryProjection(store.run?.recoveryResult);
  assert.equal(result.kind, 'SAFE_RUNTIME_V1');
  return result.projection;
}

test('persists release start before its Gateway operation and keeps unconfigured verification recovering', async () => {
  const store = new MemoryRecoveryStore(createRun());
  const drain = new MemoryDrainController({
    kind: 'DRAINED',
    participant: 'REPORT',
    metrics: { participants: 1, accepted: 2, completed: 2, inFlightAtFinish: 0 },
  });
  let releaseSignal: AbortSignal | undefined;
  const executor = createExecutor(store, drain, async (_run, signal) => {
    assert.ok(store.events.includes('RELEASE_STARTED'));
    releaseSignal = signal;
    return { ignored: 'not persisted' };
  });

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(drain.calls, 1);
  assert.ok(releaseSignal instanceof AbortSignal);
  assert.equal(projection.drain.status, 'SUCCEEDED');
  assert.equal(projection.release.status, 'SUCCEEDED');
  assert.equal(projection.cleanup.status, 'NOT_APPLICABLE');
  assert.equal(projection.verification.status, 'NOT_CONFIGURED');
  assert.equal(projection.outcome, 'VERIFY_UNAVAILABLE');
  assert.equal(store.run?.state, 'RECOVERING');
  assert.deepEqual(store.events, [
    'DRAIN_STARTED',
    'DRAIN_COMPLETED',
    'RELEASE_STARTED',
    'RELEASE_COMPLETED',
    'CLEANUP_SKIPPED',
    'VERIFY_STARTED',
    'VERIFY_UNAVAILABLE',
    'RECOVERY_BLOCKED',
  ]);
});

test('logs only the recovery summary after persisting each recovery fact', async () => {
  const store = new MemoryRecoveryStore(createRun());
  const summaries: object[] = [];
  const executor = new FaultRunRecoveryExecutor(
    store,
    new MemoryDrainController({
      kind: 'DRAINED',
      participant: 'REPORT',
      metrics: { participants: 1, inFlightAtFinish: 0 },
    }),
    { stop: async () => ({}), cleanup: async () => ({}) },
    {
      drainTimeoutMs: 30_000,
      recoveryTimeoutMs: 60_000,
      now: () => now,
      logger: {
        info(details: unknown, message?: unknown) {
          if (message === 'Fault Run recovery state persisted'
            && typeof details === 'object'
            && details !== null) {
            summaries.push(details);
          }
        },
        warn() {},
      },
    },
  );

  await executor.execute(runId);

  assert.ok(summaries.length > 0);
  for (const summary of summaries) {
    assert.ok(Object.keys(summary).every((key) =>
      ['phase', 'outcome', 'attempt', 'errorCode'].includes(key)));
  }
  assert.deepEqual(summaries.at(-1), {
    phase: 'PARTIAL_RECOVERY',
    outcome: 'VERIFY_UNAVAILABLE',
    attempt: 1,
    errorCode: 'VERIFY_UNAVAILABLE',
  });
});

test('closes the Worker gate before recording and waiting for the drain', async () => {
  const store = new MemoryRecoveryStore(createRun());
  const order: string[] = [];
  const drain: FaultRunRecoveryDrainController = {
    async closeGate() {
      order.push('gate-closed');
      return { kind: 'CLOSED', participant: 'REPORT' };
    },
    async drain() {
      assert.ok(store.events.includes('DRAIN_STARTED'));
      order.push('drain-waited');
      return { kind: 'DRAINED', participant: 'REPORT' };
    },
  };
  const executor = createExecutor(store, drain);

  await executor.execute(runId);

  assert.deepEqual(order, ['gate-closed', 'drain-waited']);
});

test('persists a registry drain timeout before accepting its late completion event', async () => {
  let resolveParticipant!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveParticipant = resolve;
  });
  const lateEvents: Record<string, unknown>[] = [];
  const registry = new FaultRunDrainRegistry({
    appendLateCompletion: async (_faultRunId, payload) => {
      lateEvents.push(payload);
    },
  });
  const startedAt = new Date();
  const run = createRun({
    recoveryResult: createInitialFaultRunRecoveryProjection({
      reason: 'MANUAL',
      requestedAt: startedAt,
      drainDeadlineAt: new Date(startedAt.getTime() + 20),
      recoveryDeadlineAt: new Date(startedAt.getTime() + 100),
    }),
  });
  registry.register(run.faultRunId, {
    kind: 'REPORT',
    requestStop: () => {},
    settled: () => settled,
  });
  const store = new MemoryRecoveryStore(run);
  const executor = new FaultRunRecoveryExecutor(store, registry, {
    stop: async () => ({}),
    cleanup: async () => ({}),
  }, {
    drainTimeoutMs: 20,
    recoveryTimeoutMs: 100,
    now: () => new Date(),
    logger: { info() {}, warn() {} },
  });

  await executor.execute(run.faultRunId);
  assert.ok(store.events.includes('DRAIN_TIMED_OUT'));
  assert.equal(lateEvents.length, 0);

  resolveParticipant();
  for (let attempt = 0; attempt < 20 && lateEvents.length === 0; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(lateEvents.length, 1);
  assert.equal(lateEvents[0]?.participant, 'REPORT');
  assert.equal(lateEvents[0]?.status, 'COMPLETED');
});

test('fails closed when the expected Worker participant is missing', async () => {
  const store = new MemoryRecoveryStore(createRun());
  const drain = new MemoryDrainController({ kind: 'MISSING', participant: 'REPORT' });
  let releases = 0;
  const executor = createExecutor(store, drain, async () => {
    releases++;
    return {};
  });

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(projection.drain.status, 'FAILED');
  assert.equal(projection.drain.errorCode, 'DRAIN_PARTICIPANT_MISSING');
  assert.equal(projection.outcome, 'PARTIAL_RECOVERY');
  assert.equal(projection.residuals[0]?.kind, 'DRAIN_UNCERTAIN');
  assert.equal(releases, 0);
  assert.deepEqual(store.events, ['DRAIN_STARTED', 'DRAIN_FAILED', 'RECOVERY_BLOCKED']);
});

test('fails closed when a drain controller reports a different participant kind', async () => {
  const store = new MemoryRecoveryStore(createRun());
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'SURGE' }),
  );

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(projection.drain.status, 'FAILED');
  assert.equal(projection.drain.errorCode, 'DRAIN_FAILED');
  assert.equal(projection.drain.participantKinds?.[0], 'REPORT');
  assert.equal(projection.outcome, 'PARTIAL_RECOVERY');
});

test('uses the same durable stop and recovery path for expired active Runs', async () => {
  const store = new MemoryRecoveryStore(createRun({
    state: 'ACTIVE',
    stopReason: null,
    recoveryResult: null,
    expiresAt: '2026-09-17T23:59:00.000Z',
  }));
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'REPORT' }),
  );

  await executor.scan();

  const projection = recoveryOf(store);
  assert.equal(store.requestStops.length, 1);
  assert.equal(store.requestStops[0]?.reason, 'EXPIRED');
  assert.equal(projection.stop.reason, 'EXPIRED');
  assert.equal(projection.outcome, 'VERIFY_UNAVAILABLE');
});

test('coalesces concurrent execution requests for the same Run', async () => {
  const deferred: { resolve: ((result: FaultRunRecoveryDrainResult) => void) | null } = { resolve: null };
  const store = new MemoryRecoveryStore(createRun());
  const drain: FaultRunRecoveryDrainController = {
    closeGate: async () => ({ kind: 'CLOSED', participant: 'REPORT' }),
    drain: () => new Promise((resolve) => {
      deferred.resolve = resolve;
    }),
  };
  const executor = createExecutor(store, drain);

  const first = executor.execute(runId);
  const second = executor.execute(runId);
  assert.strictEqual(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  const resolveDrain = deferred.resolve;
  assert.ok(resolveDrain);
  resolveDrain({ kind: 'DRAINED', participant: 'REPORT' });
  await first;

  assert.deepEqual(store.events.filter((event) => event === 'DRAIN_STARTED'), ['DRAIN_STARTED']);
});

test('does not issue a target release when persisting RELEASE_STARTED fails', async () => {
  const store = new MemoryRecoveryStore(createRun());
  store.failEvent = 'RELEASE_STARTED';
  let releases = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'REPORT' }),
    async () => {
      releases++;
      return {};
    },
  );

  await executor.execute(runId);

  assert.equal(releases, 0);
  assert.equal(recoveryOf(store).release.status, 'NOT_STARTED');
});

test('retries release completion persistence without issuing the target release again', async () => {
  const store = new MemoryRecoveryStore(createRun());
  store.failEvent = 'RELEASE_COMPLETED';
  let releases = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'REPORT' }),
    async () => {
      releases++;
      return {};
    },
  );

  await executor.execute(runId);
  assert.equal(releases, 1);
  assert.equal(recoveryOf(store).release.status, 'RUNNING');

  store.failEvent = null;
  await executor.execute(runId);

  assert.equal(releases, 1);
  assert.equal(recoveryOf(store).release.status, 'SUCCEEDED');
  assert.equal(recoveryOf(store).outcome, 'VERIFY_UNAVAILABLE');
});

test('does not issue a target release after the absolute recovery deadline has elapsed', async () => {
  const elapsed = createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt: new Date('2026-09-17T23:59:00.000Z'),
    drainDeadlineAt: new Date('2026-09-17T23:59:30.000Z'),
    recoveryDeadlineAt: now,
  });
  const store = new MemoryRecoveryStore(createRun({ recoveryResult: elapsed }));
  let releases = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'REPORT' }),
    async () => {
      releases++;
      return {};
    },
  );

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(releases, 0);
  assert.equal(projection.release.status, 'TIMED_OUT');
  assert.equal(projection.release.errorCode, 'TARGET_RELEASE_TIMEOUT');
  assert.equal(projection.outcome, 'RELEASE_FAILED');
});

test('resumes an in-progress release without preparing a new target effect', async () => {
  const initial = initialProjection();
  const draining = mergeFaultRunRecoveryStep(initial, {
    stage: 'DRAIN',
    step: {
      status: 'RUNNING',
      attempt: 1,
      startedAt: now.toISOString(),
      participantKinds: ['REPORT'],
    },
    phase: 'DRAINING',
    outcome: 'PENDING',
    residuals: [],
  });
  const drained = mergeFaultRunRecoveryStep(draining, {
    stage: 'DRAIN',
    step: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      participantKinds: ['REPORT'],
    },
    phase: 'RELEASING',
    outcome: 'PENDING',
    residuals: [],
  });
  const releasing = mergeFaultRunRecoveryStep(drained, {
    stage: 'RELEASE',
    step: {
      status: 'RUNNING',
      attempt: 1,
      startedAt: now.toISOString(),
    },
    phase: 'RELEASING',
    outcome: 'PENDING',
    residuals: [],
  });
  const store = new MemoryRecoveryStore(createRun({ recoveryResult: releasing }));
  let releases = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'REPORT' }),
    async () => {
      releases++;
      return {};
    },
  );

  await executor.execute(runId);

  assert.equal(releases, 1);
  assert.equal(recoveryOf(store).release.status, 'SUCCEEDED');
  assert.equal(recoveryOf(store).outcome, 'VERIFY_UNAVAILABLE');
});

test('resumes release after a persisted drain timeout without erasing the timeout fact', async () => {
  const initial = initialProjection();
  const draining = mergeFaultRunRecoveryStep(initial, {
    stage: 'DRAIN',
    step: {
      status: 'RUNNING',
      attempt: 1,
      startedAt: now.toISOString(),
      participantKinds: ['REPORT'],
    },
    phase: 'DRAINING',
    outcome: 'PENDING',
    residuals: [],
  });
  const timedOut = mergeFaultRunRecoveryStep(draining, {
    stage: 'DRAIN',
    step: {
      status: 'TIMED_OUT',
      attempt: 1,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      errorCode: 'DRAIN_TIMEOUT',
      participantKinds: ['REPORT'],
    },
    phase: 'PARTIAL_RECOVERY',
    outcome: 'DRAIN_TIMEOUT',
    residuals: [{
      kind: 'DRAIN_UNCERTAIN',
      responsibility: 'CONTROL_PLANE',
      nextAction: 'INVESTIGATE_DRAIN',
    }],
    lastError: {
      stage: 'DRAIN',
      code: 'DRAIN_TIMEOUT',
      retryable: true,
    },
  });
  const releasing = mergeFaultRunRecoveryStep(timedOut, {
    stage: 'RELEASE',
    step: {
      status: 'RUNNING',
      attempt: 1,
      startedAt: now.toISOString(),
    },
    phase: 'PARTIAL_RECOVERY',
    outcome: 'DRAIN_TIMEOUT',
    residuals: timedOut.residuals,
    lastError: timedOut.lastError,
  });
  const store = new MemoryRecoveryStore(createRun({ recoveryResult: releasing }));
  let releases = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'TIMED_OUT', participant: 'REPORT' }),
    async () => {
      releases++;
      return {};
    },
  );

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(releases, 1);
  assert.equal(projection.drain.status, 'TIMED_OUT');
  assert.equal(projection.release.status, 'SUCCEEDED');
  assert.equal(projection.outcome, 'VERIFY_UNAVAILABLE');
  assert.ok(projection.residuals.some((residual) => residual.kind === 'DRAIN_UNCERTAIN'));
});

test('requires operator-confirmed cleanup instead of issuing destructive cleanup work', async () => {
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage-append',
  }));
  let releases = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'RUNNER' }),
    async () => {
      releases++;
      return {};
    },
  );

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(releases, 1);
  assert.equal(projection.cleanup.status, 'MANUAL_REQUIRED');
  assert.equal(projection.phase, 'MANUAL_CLEANUP_REQUIRED');
  assert.equal(projection.outcome, 'MANUAL_CLEANUP_REQUIRED');
  assert.equal(projection.verification.status, 'NOT_STARTED');
  assert.equal(store.completeCalls.length, 0);
});

test('executes accepted manual cleanup in the Worker, then resumes verification without repeating cleanup', async () => {
  const manualCleanupRequired = createManualCleanupRequiredProjection();
  const cleaning = startFaultRunManualCleanup(
    manualCleanupRequired,
    'b'.repeat(64),
    new Date('2026-09-18T00:00:20.000Z'),
  );
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    recoveryResult: cleaning,
  }));
  let releases = 0;
  let cleanups = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'RUNNER' }),
    async () => {
      releases++;
      return {};
    },
    async (_run, signal) => {
      cleanups++;
      assert.ok(signal instanceof AbortSignal);
      return { ignored: 'target response must not enter the projection' };
    },
  );

  await executor.execute(runId);

  let projection = recoveryOf(store);
  assert.equal(releases, 0);
  assert.equal(cleanups, 1);
  assert.equal(projection.cleanup.status, 'SUCCEEDED');
  assert.equal(projection.cleanup.requestKeyHash, undefined);
  assert.equal(projection.phase, 'VERIFYING');
  assert.equal(projection.outcome, 'PENDING');
  assert.equal(projection.residuals.some((residual) => residual.kind === 'MANUAL_CLEANUP_PENDING'), false);
  assert.deepEqual(store.events, ['MANUAL_CLEANUP_COMPLETED']);

  await executor.execute(runId);

  projection = recoveryOf(store);
  assert.equal(cleanups, 1);
  assert.equal(projection.verification.status, 'NOT_CONFIGURED');
  assert.equal(projection.outcome, 'VERIFY_UNAVAILABLE');
  assert.equal(store.run?.state, 'RECOVERING');
});

test('records a stable manual cleanup failure without exposing target details', async () => {
  const cleaning = startFaultRunManualCleanup(
    createManualCleanupRequiredProjection(),
    'c'.repeat(64),
    new Date('2026-09-18T00:00:20.000Z'),
  );
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    recoveryResult: cleaning,
  }));
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'RUNNER' }),
    async () => ({}),
    async () => {
      throw new Error('target response includes credentials');
    },
  );

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(projection.cleanup.status, 'FAILED');
  assert.equal(projection.cleanup.errorCode, 'CLEANUP_OPERATION_FAILED');
  assert.equal(projection.phase, 'PARTIAL_RECOVERY');
  assert.equal(projection.outcome, 'CLEANUP_FAILED');
  assert.deepEqual(projection.lastError, {
    stage: 'CLEANUP',
    code: 'CLEANUP_OPERATION_FAILED',
    retryable: true,
  });
  assert.equal(store.events.includes('MANUAL_CLEANUP_FAILED'), true);
  assert.equal(JSON.stringify(store.completeManualCleanupCalls[0]).includes('credentials'), false);
});

test('does not issue manual cleanup after its recovery deadline and records a timeout', async () => {
  const cleaning = startFaultRunManualCleanup(
    createManualCleanupRequiredProjection(now),
    'f'.repeat(64),
    now,
  );
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    recoveryResult: cleaning,
  }));
  let cleanups = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'RUNNER' }),
    async () => ({}),
    async () => {
      cleanups++;
      return {};
    },
  );

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(cleanups, 0);
  assert.equal(projection.cleanup.status, 'TIMED_OUT');
  assert.equal(projection.cleanup.errorCode, 'CLEANUP_OPERATION_FAILED');
  assert.equal(projection.outcome, 'CLEANUP_FAILED');
});

test('retries manual cleanup completion persistence without issuing cleanup again', async () => {
  const cleaning = startFaultRunManualCleanup(
    createManualCleanupRequiredProjection(),
    'd'.repeat(64),
    new Date('2026-09-18T00:00:20.000Z'),
  );
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    recoveryResult: cleaning,
  }));
  store.failEvent = 'MANUAL_CLEANUP_COMPLETED';
  let cleanups = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'RUNNER' }),
    async () => ({}),
    async () => {
      cleanups++;
      return {};
    },
  );

  await executor.execute(runId);
  assert.equal(cleanups, 1);
  assert.equal(recoveryOf(store).phase, 'CLEANING');

  store.failEvent = null;
  await executor.execute(runId);

  assert.equal(cleanups, 1);
  assert.equal(recoveryOf(store).phase, 'VERIFYING');
  assert.equal(store.events.filter((event) => event === 'MANUAL_CLEANUP_COMPLETED').length, 1);
});

test('resumes a persisted cleanup command after Worker restart', async () => {
  const cleaning = startFaultRunManualCleanup(
    createManualCleanupRequiredProjection(),
    'e'.repeat(64),
    new Date('2026-09-18T00:00:20.000Z'),
  );
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    recoveryResult: cleaning,
  }));
  let cleanups = 0;
  const restartedExecutor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'RUNNER' }),
    async () => ({}),
    async () => {
      cleanups++;
      return {};
    },
  );

  await restartedExecutor.execute(runId);

  assert.equal(cleanups, 1);
  assert.equal(recoveryOf(store).cleanup.status, 'SUCCEEDED');
  assert.equal(recoveryOf(store).phase, 'VERIFYING');
});

test('owner-fences the release action and its recovery projection', async () => {
  const store = new MemoryRecoveryStore(createRun({ execution: createExecution() }));
  let releases = 0;
  const executor = createOwnedExecutor(store, async (_run, signal) => {
    releases++;
    assert.ok(signal instanceof AbortSignal);
    assert.ok(store.events.includes('RELEASE_STARTED'));
    assert.equal(store.actions[0]?.actionState, 'DISPATCHING');
    assert.equal(store.actions[0]?.dispatchOwnerId, 'recovery-owner');
    return {
      code: 200,
      data: { code: 200, data: { released: true, operation: 'products-browse-report' } },
    };
  });

  await executor.execute(runId);

  assert.equal(releases, 1);
  assert.equal(store.actions[0]?.actionState, 'CONFIRMED');
  assert.equal(store.actions[0]?.resultSummary && typeof store.actions[0]?.resultSummary, 'object');
  assert.equal(recoveryOf(store).release.status, 'SUCCEEDED');
  assert.ok(store.events.includes('RELEASE_COMPLETED'));
  assert.equal(store.execution?.ownerId, 'recovery-owner');
  assert.deepEqual((await executor.stop()).failedRunIds, []);
  assert.equal(store.execution?.ownerId, null);
});

test('unknown release outcomes require intervention and are never retried', async () => {
  const store = new MemoryRecoveryStore(createRun({ execution: createExecution() }));
  let releases = 0;
  const executor = createOwnedExecutor(store, async () => {
    releases++;
    return { code: 200, data: { code: 200, data: { released: false } } };
  });

  await executor.execute(runId);
  await executor.execute(runId);

  assert.equal(releases, 1);
  assert.equal(store.actions[0]?.actionState, 'OUTCOME_UNKNOWN');
  assert.equal(store.execution?.reconciliationState, 'MANUAL_INTERVENTION_REQUIRED');
  assert.equal(recoveryOf(store).release.status, 'RUNNING');
  assert.equal(store.events.filter((event) => event === 'ACTION_OUTCOME_UNKNOWN').length, 1);
});

test('late release responses remain unknown after the recovery deadline', async () => {
  const shortRecovery = createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt: now,
    drainDeadlineAt: new Date(now.getTime() + 5),
    recoveryDeadlineAt: new Date(now.getTime() + 20),
  });
  const store = new MemoryRecoveryStore(createRun({
    execution: createExecution(),
    recoveryResult: shortRecovery,
  }));
  let resolveRelease!: (value: unknown) => void;
  let releaseSignal: AbortSignal | undefined;
  let releases = 0;
  const executor = createOwnedExecutor(store, async (_run, signal) => {
    releases++;
    releaseSignal = signal;
    return new Promise((resolve) => { resolveRelease = resolve; });
  });

  await executor.execute(runId);
  assert.equal(releases, 1);
  assert.equal(releaseSignal?.aborted, true);
  assert.equal(store.actions[0]?.actionState, 'OUTCOME_UNKNOWN');
  resolveRelease({
    code: 200,
    data: { code: 200, data: { released: true, operation: 'products-browse-report' } },
  });
  await executor.execute(runId);

  assert.equal(releases, 1);
  assert.equal(store.actions[0]?.actionState, 'OUTCOME_UNKNOWN');
  assert.equal(recoveryOf(store).release.status, 'RUNNING');
});

test('owner-fences operator-confirmed cleanup and resumes verification', async () => {
  const cleanupKey = 'b'.repeat(64);
  const cleaning = startFaultRunManualCleanup(
    createManualCleanupRequiredProjection(),
    cleanupKey,
    new Date('2026-09-18T00:00:20.000Z'),
  );
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    recoveryResult: cleaning,
    execution: createExecution(),
  }));
  store.actions.push(createAction('CLEANUP', cleanupKey));
  let cleanups = 0;
  const executor = createOwnedExecutor(store, async () => {
    throw new Error('release must not run');
  }, async (_run, signal) => {
    cleanups++;
    assert.ok(signal instanceof AbortSignal);
    return {
      code: 200,
      data: { code: 200, data: { cleaned: true, operation: 'notification-storage' } },
    };
  });

  await executor.execute(runId);

  assert.equal(cleanups, 1);
  assert.equal(store.actions[0]?.actionState, 'CONFIRMED');
  assert.equal(recoveryOf(store).cleanup.status, 'SUCCEEDED');
  assert.equal(recoveryOf(store).phase, 'VERIFYING');
  assert.ok(store.events.includes('MANUAL_CLEANUP_COMPLETED'));
  assert.deepEqual((await executor.stop()).failedRunIds, []);
});

test('consumes terminal per-run cleanup intents through an owner-fenced action', async () => {
  const store = new MemoryRecoveryStore(createRun({
    state: 'RECOVERED',
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    execution: { ...createExecution(), drainState: 'DRAINED' },
  }));
  store.actions.push(createAction('CLEANUP', 'terminal-cleanup-001'));
  let cleanups = 0;
  const executor = createOwnedExecutor(store, async () => ({}), async () => {
    cleanups++;
    return {
      code: 200,
      data: { code: 200, data: { cleaned: true, operation: 'notification-storage' } },
    };
  });

  await executor.scan();

  assert.equal(cleanups, 1);
  assert.equal(store.run?.state, 'RECOVERED');
  assert.equal(store.actions[0]?.actionState, 'CONFIRMED');
  assert.ok(store.events.includes('MANUAL_CLEANUP_COMPLETED'));
  assert.equal(store.execution?.ownerId, null);
});

test('records non-releasing recovery without calling the target release operation', async () => {
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    targetService: 'notification-service',
    targetOperation: 'notification-heap-retention',
  }));
  let releases = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'RUNNER' }),
    async () => {
      releases++;
      return {};
    },
  );

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(releases, 0);
  assert.equal(projection.release.status, 'NOT_APPLICABLE');
  assert.equal(projection.phase, 'NON_RELEASING_ACTIVE');
  assert.equal(projection.outcome, 'NON_RELEASING_ACTIVE');
  assert.equal(projection.residuals[0]?.kind, 'NON_RELEASING_EFFECT');
  assert.equal(store.completeCalls.length, 1);
});

test('reports unpersisted recovery work to the Worker shutdown coordinator', async () => {
  const store = new MemoryRecoveryStore(createRun());
  store.failEvent = 'DRAIN_STARTED';
  const drain = new MemoryDrainController({
    kind: 'DRAINED',
    participant: 'REPORT',
    metrics: { participants: 1, inFlightAtFinish: 0 },
  });
  const executor = createExecutor(store, drain);

  await executor.execute(runId);
  assert.deepEqual((await executor.stop()).failedRunIds, [runId]);

  const retriedStore = new MemoryRecoveryStore(createRun());
  retriedStore.failEvent = 'DRAIN_STARTED';
  const retriedExecutor = createExecutor(retriedStore, drain);
  await retriedExecutor.execute(runId);
  retriedStore.failEvent = null;
  await retriedExecutor.execute(runId);
  assert.deepEqual((await retriedExecutor.stop()).failedRunIds, []);
});

test('reports a recovering Run with an unreadable projection to Worker shutdown', async () => {
  const store = new MemoryRecoveryStore(createRun({ recoveryResult: null }));
  const executor = createExecutor(store, new MemoryDrainController({
    kind: 'DRAINED',
    participant: 'REPORT',
    metrics: { participants: 1, inFlightAtFinish: 0 },
  }));

  await executor.execute(runId);

  assert.deepEqual((await executor.stop()).failedRunIds, [runId]);
  assert.deepEqual(store.events, []);
});

test('stopping waits for an in-flight scan and prevents it from starting recovery work', async () => {
  let releaseScan!: () => void;
  const scanBlocked = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  let loads = 0;
  const store: FaultRunRecoveryStore = {
    load: async () => {
      loads++;
      return createRun();
    },
    listRecovering: async () => {
      await scanBlocked;
      return [createRun()];
    },
    listExpiredRunnable: async () => [],
    requestStop: async () => null,
    recordStep: async () => null,
    complete: async () => null,
    completeManualCleanup: async () => null,
  };
  const drain = new MemoryDrainController({
    kind: 'DRAINED',
    participant: 'REPORT',
    metrics: { participants: 1, inFlightAtFinish: 0 },
  });
  const executor = new FaultRunRecoveryExecutor(store, drain, {
    stop: async () => ({}),
    cleanup: async () => ({}),
  }, {
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
    now: () => now,
    logger: { info() {}, warn() {} },
  });

  const scan = executor.scan();
  await Promise.resolve();
  const stopping = executor.stop();
  releaseScan();
  await Promise.all([scan, stopping]);

  assert.equal(loads, 0);
  assert.deepEqual((await executor.stop()).failedRunIds, []);
});

test('preserves service-unavailable recovery while recording a non-releasing residual', async () => {
  const serviceUnavailable = createInitialFaultRunRecoveryProjection({
    reason: 'SERVICE_UNAVAILABLE',
    requestedAt: now,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
  });
  const store = new MemoryRecoveryStore(createRun({
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    targetService: 'notification-service',
    targetOperation: 'notification-retention',
    recoveryResult: serviceUnavailable,
  }));
  let releases = 0;
  const executor = createExecutor(
    store,
    new MemoryDrainController({ kind: 'DRAINED', participant: 'RUNNER' }),
    async () => {
      releases++;
      return {};
    },
  );

  await executor.execute(runId);

  const projection = recoveryOf(store);
  assert.equal(releases, 0);
  assert.equal(projection.phase, 'PARTIAL_RECOVERY');
  assert.equal(projection.outcome, 'SERVICE_UNAVAILABLE');
  assert.ok(projection.residuals.some((residual) => residual.kind === 'SERVICE_RECOVERY_REQUIRED'));
  assert.ok(projection.residuals.some((residual) => residual.kind === 'NON_RELEASING_EFFECT'));
});
