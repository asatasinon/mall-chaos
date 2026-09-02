import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlledExerciseWorker, ExerciseRequestTimeoutError } from './controlled-exercise-worker';
import type { FaultRunRecord } from '../lib/fault-run-repository';

const run = {
  faultRunId: '123e4567-e89b-12d3-a456-426614174000',
  scenario: 'BROWSE_SURGE',
  targetService: 'traffic-control-plane',
  targetOperation: 'browse-api-worker',
  state: 'ACTIVE',
  parameters: { durationSec: 1 },
  idempotencyKey: 'controlled-worker-test',
  fencingToken: 1,
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 1000).toISOString(),
  stoppedAt: null,
  stopReason: null,
  recoveryResult: null,
  recoveryError: null,
  operatorAuditId: null,
  traceId: 'trace',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as FaultRunRecord;

test('controlled worker respects concurrency and drains aborted requests', async () => {
  let active = 0;
  let maximum = 0;
  const worker = new ControlledExerciseWorker(run, {
    concurrency: 3,
    requestIntervalMs: 0,
    request: async (signal) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 25);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      active--;
    },
  }, async () => undefined);

  const running = worker.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const stats = await worker.stop('MANUAL');
  await running;
  assert.equal(maximum, 3);
  assert.equal(stats.inFlight, 0);
  assert.equal(stats.stopReason, 'MANUAL');
  assert.equal(active, 0);
  assert.equal(stats.timeouts, 0);
  assert.equal(stats.cacheResults.CACHE_UNKNOWN, stats.successes);
  assert.equal(stats.p50LatencyMs > 0, true);
});

test('controlled worker waits for the configured interval between batches', async () => {
  const requestStartedAt: number[] = [];
  let resolveSecondRequest!: () => void;
  const secondRequest = new Promise<void>((resolve) => {
    resolveSecondRequest = resolve;
  });
  const worker = new ControlledExerciseWorker({
    ...run,
    expiresAt: new Date(Date.now() + 500).toISOString(),
  }, {
    concurrency: 1,
    requestIntervalMs: 40,
    request: async () => {
      requestStartedAt.push(Date.now());
      if (requestStartedAt.length === 2) resolveSecondRequest();
    },
  }, async () => undefined);

  const running = worker.start();
  await secondRequest;
  const stats = await worker.stop('INTERVAL_TEST');
  await running;

  assert.equal(stats.requests >= 2, true);
  assert.equal(requestStartedAt[1] - requestStartedAt[0] >= 30, true);
});

test('controlled worker counts timeout requests and records low-cardinality results', async () => {
  const timeoutWorker = new ControlledExerciseWorker({
    ...run,
    expiresAt: new Date(Date.now() + 100).toISOString(),
  }, {
    concurrency: 1,
    requestIntervalMs: 0,
    request: async () => {
      throw new ExerciseRequestTimeoutError();
    },
  }, async () => undefined);

  const stats = await timeoutWorker.start().then(() => timeoutWorker.snapshot());

  assert.equal(stats.requests > 0, true);
  assert.equal(stats.timeouts, stats.failures);
  assert.equal(stats.cacheResults.CACHE_UNKNOWN, 0);
});

test('controlled worker aggregates cache results returned by a request', async () => {
  const cacheWorker = new ControlledExerciseWorker({
    ...run,
    expiresAt: new Date(Date.now() + 40).toISOString(),
  }, {
    concurrency: 1,
    requestIntervalMs: 0,
    request: async () => ({ cacheResult: 'CACHE_HIT' }),
  }, async () => undefined);

  const stats = await cacheWorker.start().then(() => cacheWorker.snapshot());

  assert.equal(stats.cacheResults.CACHE_HIT, stats.successes);
  assert.equal(stats.cacheResults.CACHE_UNKNOWN, 0);
});
