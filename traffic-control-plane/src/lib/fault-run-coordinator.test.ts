import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planFaultRunStop,
  type CreateFaultRunInput,
  type FaultRunCommandResult,
  type FaultRunRecord,
  type RequestFaultRunStopInput,
} from './fault-run-repository';
import {
  createInitialFaultRunRecoveryProjection,
  parseFaultRunRecoveryProjection,
} from './fault-run-recovery';
import { FaultRunCoordinator, type FaultRunStore, type FaultRunTargetAdapter } from './fault-run-coordinator';
import { LegacyFaultRunRecovery } from './legacy-fault-run-recovery';
import type { FaultRunState } from './fault-run-catalog';

const runId = '123e4567-e89b-12d3-a456-426614174000';

class MemoryFaultRunStore implements FaultRunStore {
  run: FaultRunRecord | null = null;
  events: string[] = [];
  eventPayloads: unknown[] = [];

  async create(input: CreateFaultRunInput) {
    if (this.run) return { run: this.run, created: false };
    this.run = {
      faultRunId: runId,
      scenario: input.scenario,
      targetService: input.targetService,
      targetOperation: input.targetOperation,
      state: 'CREATING',
      parameters: input.parameters,
      idempotencyKey: input.idempotencyKey,
      fencingToken: 1,
      startedAt: null,
      expiresAt: input.expiresAt.toISOString(),
      stoppedAt: null,
      stopReason: null,
      recoveryResult: null,
      recoveryError: null,
      operatorAuditId: null,
      traceId: input.traceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.events.push('CREATED');
    this.eventPayloads.push(undefined);
    return { run: this.run, created: true };
  }

  async load() { return this.run; }
  async listActive() { return this.run && ['CREATING', 'ACTIVE', 'RECOVERING'].includes(this.run.state) ? [this.run] : []; }
  async listExpired() { return this.run && ['CREATING', 'ACTIVE', 'RECOVERING'].includes(this.run.state) ? [this.run] : []; }
  async requestStop(input: RequestFaultRunStopInput): Promise<FaultRunCommandResult | null> {
    if (!this.run || this.run.faultRunId !== input.faultRunId) return null;
    const plan = planFaultRunStop(this.run, {
      reason: input.reason,
      requestedAt: input.now ?? new Date(),
      drainTimeoutMs: input.drainTimeoutMs,
      recoveryTimeoutMs: input.recoveryTimeoutMs,
    });
    if (plan.disposition === 'ACCEPTED' && plan.projection) {
      this.run = {
        ...this.run,
        state: 'RECOVERING',
        stopReason: plan.projection.stop.reason,
        recoveryResult: plan.projection,
      };
      this.events.push('STOP_REQUESTED');
      this.eventPayloads.push({ reason: plan.projection.stop.reason });
    }
    return {
      disposition: plan.disposition,
      run: this.run,
      recovery: parseFaultRunRecoveryProjection(this.run.recoveryResult),
    };
  }

  async transition(
    _faultRunId: string,
    expectedStates: readonly FaultRunState[],
    nextState: FaultRunState,
    details: { eventType: string; payload?: unknown; stopReason?: string; recoveryResult?: unknown; recoveryError?: string },
  ) {
    if (!this.run || !expectedStates.includes(this.run.state)) return this.run;
    this.run = {
      ...this.run,
      state: nextState,
      startedAt: nextState === 'ACTIVE' ? this.run.startedAt ?? new Date().toISOString() : this.run.startedAt,
      stoppedAt: ['RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].includes(nextState)
        ? this.run.stoppedAt ?? new Date().toISOString()
        : this.run.stoppedAt,
      stopReason: details.stopReason ?? this.run.stopReason,
      recoveryResult: details.recoveryResult ?? this.run.recoveryResult,
      recoveryError: details.recoveryError ?? this.run.recoveryError,
    };
    this.events.push(details.eventType);
    this.eventPayloads.push(details.payload);
    return this.run;
  }

  async appendEvent(_faultRunId: string, eventType: string, payload?: unknown) {
    this.events.push(eventType);
    this.eventPayloads.push(payload);
  }
}

class MemoryTargetAdapter implements FaultRunTargetAdapter {
  starts = 0;
  stops = 0;
  cleanups = 0;
  compensations = 0;
  failStart = false;
  failStop = false;
  startResult: unknown = undefined;

  async start() {
    this.starts++;
    if (this.failStart) throw new Error('TARGET_START_FAILED');
    return this.startResult;
  }

  async stop() {
    this.stops++;
    if (this.failStop) throw new Error('TARGET_STOP_FAILED');
    return { released: true };
  }

  async cleanup() {
    this.cleanups++;
    return { cleaned: true };
  }

  async compensate() {
    this.compensations++;
  }
}

test('non-OFF create persists CREATING intent without preparing or compensating in Web/API', async () => {
  for (const scenario of ['BROWSE_REPORT_SQL', 'BROWSE_SURGE'] as const) {
    const store = new MemoryFaultRunStore();
    const target = new MemoryTargetAdapter();
    const coordinator = new FaultRunCoordinator(target, store);
    const command = {
      scenario,
      parameters: { durationSec: 30 },
      idempotencyKey: `new-mode-${scenario}`,
      traceId: 'trace-1',
      executionMode: 'OBSERVE' as const,
    };
    const result = await coordinator.create(command);
    assert.equal(result.created, true);
    assert.equal(result.run.state, 'CREATING');
    const replay = await coordinator.create(command);
    assert.equal(replay.created, false);
    assert.equal(replay.run.faultRunId, result.run.faultRunId);
    assert.equal(target.starts, 0);
    assert.equal(target.compensations, 0);
    assert.deepEqual(store.events, ['CREATED']);
  }
});

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for target prepare');
}

test('coordinator completes active, manual stop, and expiry lifecycles without a database', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const coordinator = new FaultRunCoordinator(target, store);
  const recovery = new LegacyFaultRunRecovery(target, store);

  const created = await coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'manual-stop-001',
    traceId: 'trace-1',
  });
  assert.equal(created.run.state, 'ACTIVE');
  assert.equal(target.starts, 1);

  recovery.registerRunDrain(runId, async () => ({}));
  const stopped = await recovery.stop(runId);
  assert.equal(stopped?.state, 'STOPPED');
  assert.equal(target.stops, 1);
  assert.deepEqual(store.events.slice(-2), ['RECOVERY_STARTED', 'RECOVERY_COMPLETED']);

  const repeated = await recovery.stop(runId);
  assert.equal(repeated?.state, 'STOPPED');
  assert.equal(target.stops, 1);
});

test('a shutdown stop of a committed creating Run prevents target prepare from publishing ACTIVE', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  let finishPrepare!: () => void;
  const prepare = new Promise<void>((resolve) => {
    finishPrepare = resolve;
  });
  target.start = async () => {
    target.starts++;
    await prepare;
    return { accepted: true };
  };
  const coordinator = new FaultRunCoordinator(target, store, {
    safeRuntimeEnabled: true,
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  const creating = coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'shutdown-creating-run-001',
    traceId: 'trace-shutdown-create',
  });
  await waitFor(() => store.run?.state === 'CREATING' && target.starts === 1);
  await store.requestStop({
    faultRunId: runId,
    reason: 'WORKER_SHUTDOWN',
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });
  finishPrepare();

  const result = await creating;
  assert.equal(result.run.state, 'RECOVERING');
  assert.equal(store.run?.stopReason, 'WORKER_SHUTDOWN');
  assert.equal(store.events.includes('CREATE_CANCELLED_AFTER_PREPARE'), true);
});

test('coordinator drains a registered worker before stopping its target', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const order: string[] = [];
  target.stop = async () => {
    order.push('target-stop');
    target.stops++;
    return { released: true };
  };
  const coordinator = new FaultRunCoordinator(target, store);
  const recovery = new LegacyFaultRunRecovery(target, store);
  await coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'drain-order-001',
    traceId: 'trace-drain',
  });
  recovery.registerRunDrain(runId, async () => {
    order.push('worker-drain');
    return { requests: 3, inFlight: 0 };
  });

  const stopped = await recovery.stop(runId);

  assert.equal(stopped?.state, 'STOPPED');
  assert.deepEqual(order, ['worker-drain', 'target-stop']);
  const recoveryPayload = store.eventPayloads[store.events.lastIndexOf('RECOVERY_COMPLETED')] as {
    workerDrain?: { registered?: boolean; drained?: boolean; result?: unknown };
  };
  assert.deepEqual(recoveryPayload.workerDrain, {
    registered: true,
    drained: true,
    result: { requests: 3, inFlight: 0 },
  });
});

test('legacy recovery does not release a Run whose Worker drain is unregistered', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const coordinator = new FaultRunCoordinator(target, store);
  const recovery = new LegacyFaultRunRecovery(target, store);
  await coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'missing-legacy-drain-001',
    traceId: 'trace-missing-drain',
  });

  const result = await recovery.stop(runId);

  assert.equal(result?.state, 'FAILED');
  assert.equal(target.stops, 0);
  const payload = store.eventPayloads[store.events.lastIndexOf('RECOVERY_FAILED')] as {
    workerDrain?: { registered?: boolean; drained?: boolean };
  };
  assert.deepEqual(payload.workerDrain, { registered: false, drained: false });
});

test('legacy recovery does not take over an unfinished safe-runtime projection', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const recovery = new LegacyFaultRunRecovery(target, store);
  const projection = createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt: new Date('2026-09-20T00:00:00.000Z'),
    drainDeadlineAt: new Date('2026-09-20T00:00:30.000Z'),
    recoveryDeadlineAt: new Date('2026-09-20T00:01:00.000Z'),
  });
  store.run = {
    ...store.run!,
    state: 'RECOVERING',
    recoveryResult: projection,
    stopReason: 'MANUAL',
  };

  const stopped = await recovery.stop(runId);
  await recovery.scheduleActiveRuns();

  assert.equal(stopped?.state, 'RECOVERING');
  assert.equal(store.run?.state, 'RECOVERING');
  assert.equal(target.stops, 0);
  assert.deepEqual(store.events, []);
});

test('coordinator stores a bounded catalog target summary in TARGET_CONFIRMED', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  target.startResult = {
    code: 200,
    data: {
      code: 200,
      data: {
        accepted: true,
        layout: 'HASH',
        hashKey: `catalog:product-detail:operation:${runId}`,
        memberCount: 8,
        memberSizeBytes: 65536,
        logicalBytes: 524288,
        observedBytes: 540000,
        probeSku: 'SKU-050',
        memberSkus: ['SKU-001', 'SKU-002'],
        expiresAt: '2099-01-01T00:00:00Z',
        keyTtlSec: 900,
        value: 'must-not-be-persisted',
      },
    },
  };
  const coordinator = new FaultRunCoordinator(target, store);
  const recovery = new LegacyFaultRunRecovery(target, store);

  await coordinator.create({
    scenario: 'CATALOG_REDIS_LARGE_VALUE',
    parameters: {
      durationSec: 30,
      concurrency: 4,
      requestIntervalMs: 100,
      memberCount: 8,
      memberSizeBytes: 65536,
      keyTtlSec: 900,
    },
    idempotencyKey: 'catalog-summary-001',
    traceId: 'trace-summary',
  });

  const confirmed = store.eventPayloads[store.events.lastIndexOf('TARGET_CONFIRMED')] as {
    targetSummary?: Record<string, unknown>;
  };
  assert.deepEqual(confirmed.targetSummary, {
    accepted: true,
    layout: 'HASH',
    hashKey: `catalog:product-detail:operation:${runId}`,
    memberCount: 8,
    memberSizeBytes: 65536,
    logicalBytes: 524288,
    observedBytes: 540000,
    probeSku: 'SKU-050',
    memberSkus: ['SKU-001', 'SKU-002'],
    expiresAt: '2099-01-01T00:00:00Z',
    keyTtlSec: 900,
  });
  await recovery.stop(runId);
});

test('coordinator compensates a failed create and marks it failed', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  target.failStart = true;
  const coordinator = new FaultRunCoordinator(target, store);

  await assert.rejects(() => coordinator.create({
    scenario: 'ORDER_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'failed-create-001',
    traceId: 'trace-2',
  }), /FAULT_RUN_TARGET_START_FAILED/);
  assert.equal(store.run?.state, 'FAILED');
  assert.equal(target.compensations, 1);
  assert.ok(store.events.includes('COMPENSATION_COMPLETED'));
});

test('safe runtime hands failed creation recovery to the Worker without releasing from the Web process', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  target.failStart = true;
  const coordinator = new FaultRunCoordinator(target, store, {
    safeRuntimeEnabled: true,
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  await assert.rejects(() => coordinator.create({
    scenario: 'ORDER_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'safe-failed-create-001',
    traceId: 'trace-safe-create',
  }), /FAULT_RUN_TARGET_START_FAILED/);

  const recovery = parseFaultRunRecoveryProjection(store.run?.recoveryResult);
  assert.equal(store.run?.state, 'RECOVERING');
  assert.equal(target.compensations, 0);
  assert.deepEqual(store.events, ['CREATED', 'STOP_REQUESTED']);
  assert.equal(recovery.kind, 'SAFE_RUNTIME_V1');
  assert.equal(recovery.projection.stop.reason, 'WORKER_FAILED');
});

test('safe runtime preserves a service-unavailable Run for Worker recovery', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const coordinator = new FaultRunCoordinator(target, store, {
    safeRuntimeEnabled: true,
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });
  const created = await coordinator.create({
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    parameters: { durationSec: 30, retainedBytesPerNotification: 1024, requestIntervalMs: 100 },
    idempotencyKey: 'safe-unavailable-001',
    traceId: 'trace-safe-unavailable',
  });

  const unavailable = await coordinator.markServiceUnavailable(created.run.faultRunId, {
    errorCode: 'NOTIFICATION_TARGET_DOWN',
    rawTargetPayload: 'must-not-be-persisted',
  });
  const recovered = await coordinator.markServiceRecovered(created.run.faultRunId, {
    result: { restarted: true, healthy: true, rawTargetPayload: 'must-not-be-persisted' },
  });
  const recovery = parseFaultRunRecoveryProjection(store.run?.recoveryResult);

  assert.equal(unavailable?.state, 'RECOVERING');
  assert.equal(recovered?.state, 'RECOVERING');
  assert.equal(store.events.includes('SERVICE_UNAVAILABLE'), false);
  assert.equal(store.events.includes('SERVICE_RECOVERED'), false);
  assert.equal(recovery.kind, 'SAFE_RUNTIME_V1');
  assert.equal(recovery.projection.stop.reason, 'SERVICE_UNAVAILABLE');
  assert.equal(recovery.projection.outcome, 'SERVICE_UNAVAILABLE');
  assert.equal(recovery.projection.residuals[0]?.kind, 'SERVICE_RECOVERY_REQUIRED');
});

test('service recovery persists only its closed summary', async () => {
  const store = new MemoryFaultRunStore();
  const coordinator = new FaultRunCoordinator(new MemoryTargetAdapter(), store);
  await coordinator.create({
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    parameters: { durationSec: 30, retainedBytesPerNotification: 1024, requestIntervalMs: 100 },
    idempotencyKey: 'service-summary-001',
    traceId: 'trace-service-summary',
  });
  store.run = { ...store.run!, state: 'SERVICE_UNAVAILABLE' };

  const recovered = await coordinator.markServiceRecovered(runId, {
    result: {
      restarted: true,
      healthy: true,
      mode: 'compose',
      rawTargetPayload: 'must-not-be-persisted',
    },
  });

  assert.equal(recovered?.state, 'RECOVERED');
  const payload = store.eventPayloads[store.events.lastIndexOf('SERVICE_RECOVERED')];
  assert.deepEqual(payload, {
    serviceRestarted: true,
    healthy: true,
    restartMode: 'compose',
  });
  assert.deepEqual(store.run?.recoveryResult, {
    serviceRestarted: true,
    healthy: true,
    restartMode: 'compose',
  });
});

test('hands a create-time cancellation to Worker recovery after target preparation', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const deferred: { resolve: (() => void) | null } = { resolve: null };
  target.start = async () => new Promise<void>((resolve) => {
    deferred.resolve = resolve;
  });
  const coordinator = new FaultRunCoordinator(target, store);

  const creating = coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'cancel-during-create-001',
    traceId: 'trace-cancel',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.run?.state, 'CREATING');
  store.run = {
    ...store.run!,
    state: 'RECOVERING',
    recoveryResult: { command: 'durably accepted elsewhere' },
  };
  const resolveStart = deferred.resolve;
  assert.ok(resolveStart);
  resolveStart();

  const result = await creating;

  assert.equal(result.run.state, 'RECOVERING');
  assert.equal(target.compensations, 0);
  assert.ok(store.events.includes('CREATE_CANCELLED_AFTER_PREPARE'));
});

test('expired recovery reaches RECOVERED and restarting RECOVERING reuses the same stop operation', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const coordinator = new FaultRunCoordinator(target, store);
  const recovery = new LegacyFaultRunRecovery(target, store);
  await coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'expired-run-001',
    traceId: 'trace-3',
  });

  recovery.registerRunDrain(runId, async () => ({}));
  await recovery.recoverExpiredRuns();
  assert.equal(store.run?.state, 'RECOVERED');
  assert.equal(target.stops, 1);

  store.run = { ...store.run!, state: 'RECOVERING', stoppedAt: null };
  await recovery.scheduleActiveRuns();
  assert.equal(store.run?.state, 'RECOVERED');
  assert.equal(target.stops, 2);
});
