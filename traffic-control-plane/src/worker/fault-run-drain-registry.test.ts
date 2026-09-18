import assert from 'node:assert/strict';
import test from 'node:test';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import {
  FaultRunDrainRegistry,
  type FaultRunDrainParticipant,
} from './fault-run-drain-registry';

const runId = '123e4567-e89b-12d3-a456-426614174000';

function createRun(): FaultRunRecord {
  return {
    faultRunId: runId,
    scenario: 'BROWSE_REPORT_SQL',
    targetService: 'catalog-service',
    targetOperation: 'products-browse-report',
    state: 'RECOVERING',
    parameters: { durationSec: 60 },
    idempotencyKey: 'create-request-001',
    fencingToken: 1,
    startedAt: '2026-09-18T00:00:00.000Z',
    expiresAt: '2026-09-18T00:10:00.000Z',
    stoppedAt: null,
    stopReason: 'MANUAL',
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-1',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function reportParticipant(
  settled: Promise<void>,
  onStop: () => void = () => {},
): FaultRunDrainParticipant {
  return {
    kind: 'REPORT',
    requestStop: onStop,
    settled: () => settled,
  };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (assertion()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for expected registry event');
}

test('closes a Run gate before waiting and rejects work admitted after closure', async () => {
  const finished = deferred();
  let stopRequests = 0;
  const registry = new FaultRunDrainRegistry();
  registry.register(runId, reportParticipant(finished.promise, () => {
    stopRequests++;
  }));
  const permit = registry.tryAcquire(runId, 'REPORT');
  assert.ok(permit);

  const run = createRun();
  const gate = await registry.closeGate({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
  });

  assert.equal(gate.kind, 'CLOSED');
  assert.equal(stopRequests, 1);
  assert.equal(permit.signal.aborted, true);
  assert.equal(registry.tryAcquire(runId, 'REPORT'), null);

  permit.complete();
  permit.complete();
  finished.resolve();
  const result = await registry.drain({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
    signal: new AbortController().signal,
  });

  assert.equal(result.kind, 'DRAINED');
  assert.deepEqual(result.metrics, {
    participants: 1,
    accepted: 1,
    completed: 0,
    aborted: 1,
    inFlightAtStart: 0,
    inFlightAtFinish: 0,
  });
});

test('fails closed when no expected participant has registered', async () => {
  const registry = new FaultRunDrainRegistry();
  registry.register(runId, {
    kind: 'SURGE',
    requestStop: () => {},
    settled: async () => {},
  });
  const run = createRun();

  const gate = await registry.closeGate({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
  });
  const result = await registry.drain({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
    signal: new AbortController().signal,
  });

  assert.deepEqual(gate, { kind: 'MISSING', participant: 'REPORT' });
  assert.deepEqual(result, { kind: 'MISSING', participant: 'REPORT' });
});

test('aggregates multiple participants and permits for the same Run owner', async () => {
  const first = deferred();
  const second = deferred();
  let stopRequests = 0;
  const registry = new FaultRunDrainRegistry();
  registry.register(runId, reportParticipant(first.promise, () => {
    stopRequests++;
  }));
  registry.register(runId, reportParticipant(second.promise, () => {
    stopRequests++;
  }));
  const firstPermit = registry.tryAcquire(runId, 'REPORT');
  const secondPermit = registry.tryAcquire(runId, 'REPORT');
  assert.ok(firstPermit);
  assert.ok(secondPermit);

  const run = createRun();
  await registry.closeGate({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
  });
  firstPermit.complete();
  secondPermit.complete();
  first.resolve();
  second.resolve();
  const result = await registry.drain({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
    signal: new AbortController().signal,
  });

  assert.equal(stopRequests, 2);
  assert.equal(result.kind, 'DRAINED');
  assert.deepEqual(result.metrics, {
    participants: 2,
    accepted: 2,
    completed: 0,
    aborted: 2,
    inFlightAtStart: 0,
    inFlightAtFinish: 0,
  });
});

test('reclaims a settled Run only after the caller declares its durable terminal state', async () => {
  const finished = deferred();
  const registry = new FaultRunDrainRegistry();
  const unregister = registry.register(runId, reportParticipant(finished.promise));
  const run = createRun();
  await registry.closeGate({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
  });
  finished.resolve();
  const result = await registry.drain({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
    signal: new AbortController().signal,
  });
  assert.equal(result.kind, 'DRAINED');

  unregister();
  assert.equal(registry.forgetCompletedRun(runId), true);
  const afterReclaim = await registry.closeGate({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
  });
  assert.deepEqual(afterReclaim, { kind: 'MISSING', participant: 'REPORT' });
});

test('retains timeout facts and appends one late completion only after acknowledgement', async () => {
  const finished = deferred();
  const events: Array<{ faultRunId: string; payload: Record<string, unknown> }> = [];
  const registry = new FaultRunDrainRegistry({
    appendLateCompletion: async (faultRunId, payload) => {
      events.push({ faultRunId, payload });
    },
  });
  const unregister = registry.register(runId, reportParticipant(finished.promise));
  const permit = registry.tryAcquire(runId, 'REPORT');
  assert.ok(permit);

  const run = createRun();
  await registry.closeGate({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 20),
  });
  const result = await registry.drain({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 20),
    signal: new AbortController().signal,
  });

  assert.equal(result.kind, 'TIMED_OUT');
  assert.deepEqual(result.metrics, {
    participants: 1,
    accepted: 1,
    completed: 0,
    aborted: 0,
    inFlightAtStart: 1,
    inFlightAtDeadline: 1,
  });
  assert.equal(events.length, 0);

  registry.acknowledgeDrainTimeout({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
  });
  const retry = await registry.drain({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
    signal: new AbortController().signal,
  });
  assert.equal(retry.kind, 'TIMED_OUT');

  unregister();
  assert.equal(registry.forgetCompletedRun(runId), false);
  permit.complete();
  finished.resolve();

  await waitFor(() => events.length === 1);
  assert.equal(events[0]?.faultRunId, runId);
  assert.deepEqual(events[0]?.payload, {
    schemaVersion: 1,
    source: 'safe-runtime',
    phase: 'drain',
    status: 'COMPLETED',
    participants: 1,
    accepted: 1,
    completed: 0,
    aborted: 1,
    inFlightAtStart: 1,
    inFlightAtFinish: 0,
    participant: 'REPORT',
    completedAt: events[0]?.payload.completedAt,
  });
  assert.equal(typeof events[0]?.payload.completedAt, 'string');
  assert.equal(events.length, 1);
  assert.equal(registry.forgetCompletedRun(runId), true);
});

test('reports a stop failure without treating the participant as drained', async () => {
  const registry = new FaultRunDrainRegistry();
  registry.register(runId, reportParticipant(new Promise(() => {}), () => {
    throw new Error('STOP_FAILED');
  }));

  const result = await registry.closeGate({
    run: createRun(),
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
  });

  assert.equal(result.kind, 'FAILED');
  assert.equal(result.participant, 'REPORT');
});
