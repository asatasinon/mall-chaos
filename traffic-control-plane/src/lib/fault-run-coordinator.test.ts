import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateFaultRunInput, FaultRunRecord } from './fault-run-repository';
import { FaultRunCoordinator, type FaultRunStore, type FaultRunTargetAdapter } from './fault-run-coordinator';
import type { FaultRunState } from './fault-run-catalog';

const runId = '123e4567-e89b-12d3-a456-426614174000';

class MemoryFaultRunStore implements FaultRunStore {
  run: FaultRunRecord | null = null;
  events: string[] = [];

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
    return this.run;
  }

  async appendEvent(_faultRunId: string, eventType: string) { this.events.push(eventType); }
}

class MemoryTargetAdapter implements FaultRunTargetAdapter {
  starts = 0;
  stops = 0;
  compensations = 0;
  failStart = false;
  failStop = false;

  async start() {
    this.starts++;
    if (this.failStart) throw new Error('TARGET_START_FAILED');
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
