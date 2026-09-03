import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateFaultRunInput, FaultRunRecord } from './fault-run-repository';
import { FaultRunCoordinator, type FaultRunStore, type FaultRunTargetAdapter } from './fault-run-coordinator';
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

  async compensate() {
    this.compensations++;
  }
}

test('coordinator completes active, manual stop, and expiry lifecycles without a database', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const coordinator = new FaultRunCoordinator(target, store);

  const created = await coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'manual-stop-001',
    traceId: 'trace-1',
  });
  assert.equal(created.run.state, 'ACTIVE');
  assert.equal(target.starts, 1);

  const stopped = await coordinator.stop(runId);
  assert.equal(stopped?.state, 'STOPPED');
  assert.equal(target.stops, 1);
  assert.deepEqual(store.events.slice(-2), ['RECOVERY_STARTED', 'RECOVERY_COMPLETED']);

  const repeated = await coordinator.stop(runId);
  assert.equal(repeated?.state, 'STOPPED');
  assert.equal(target.stops, 1);
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
  await coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'drain-order-001',
    traceId: 'trace-drain',
  });
  coordinator.registerRunDrain(runId, async () => {
    order.push('worker-drain');
    return { requests: 3, inFlight: 0 };
  });

  const stopped = await coordinator.stop(runId);

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
  await coordinator.stop(runId);
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

test('expired recovery reaches RECOVERED and restarting RECOVERING reuses the same stop operation', async () => {
  const store = new MemoryFaultRunStore();
  const target = new MemoryTargetAdapter();
  const coordinator = new FaultRunCoordinator(target, store);
  await coordinator.create({
    scenario: 'BROWSE_REPORT_SQL',
    parameters: { durationSec: 30 },
    idempotencyKey: 'expired-run-001',
    traceId: 'trace-3',
  });

  await coordinator.recoverExpiredRuns();
  assert.equal(store.run?.state, 'RECOVERED');
  assert.equal(target.stops, 1);

  store.run = { ...store.run!, state: 'RECOVERING', stoppedAt: null };
  await coordinator.scheduleActiveRuns();
  assert.equal(store.run?.state, 'RECOVERED');
  assert.equal(target.stops, 2);
});
