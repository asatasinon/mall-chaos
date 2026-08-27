import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlledExerciseWorker } from './controlled-exercise-worker';
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
});
