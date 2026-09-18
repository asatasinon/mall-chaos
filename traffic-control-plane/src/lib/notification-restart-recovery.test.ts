import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialFaultRunRecoveryProjection,
  type FaultRunRecoveryProjection,
} from './fault-run-recovery';
import { isSafeRuntimeUnavailableHeapRun } from './notification-restart-recovery';
import type { FaultRunRecord } from './fault-run-repository';

const faultRunId = '33333333-3333-4333-8333-333333333333';

test('only permits restart for a strict safe unavailable heap recovery projection', () => {
  const recovery: FaultRunRecoveryProjection = {
    ...createInitialFaultRunRecoveryProjection({
      reason: 'SERVICE_UNAVAILABLE',
      requestedAt: '2026-09-18T00:00:00.000Z',
      drainDeadlineAt: '2026-09-18T00:00:30.000Z',
      recoveryDeadlineAt: '2026-09-18T00:01:00.000Z',
    }),
    residuals: [{
      kind: 'SERVICE_RECOVERY_REQUIRED',
      responsibility: 'SERVICE_OWNER',
      nextAction: 'WAIT_FOR_SERVICE_RECOVERY',
    }],
  };
  const valid = run({
    recoveryResult: recovery,
  });

  assert.equal(isSafeRuntimeUnavailableHeapRun(valid), true);
  assert.equal(isSafeRuntimeUnavailableHeapRun({
    ...valid,
    state: 'SERVICE_UNAVAILABLE',
  }), false);
  assert.equal(isSafeRuntimeUnavailableHeapRun({
    ...valid,
    scenario: 'NOTIFICATION_STORAGE_APPEND',
  }), false);
  assert.equal(isSafeRuntimeUnavailableHeapRun({
    ...valid,
    recoveryResult: null,
  }), false);
  assert.equal(isSafeRuntimeUnavailableHeapRun({
    ...valid,
    recoveryResult: {
      ...recovery,
      outcome: 'RECOVERED',
    },
  }), false);
});

function run(overrides: Partial<FaultRunRecord> = {}): FaultRunRecord {
  return {
    faultRunId,
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    targetService: 'notification-service',
    targetOperation: 'notification-heap-retention',
    state: 'RECOVERING',
    parameters: { durationSec: 60 },
    idempotencyKey: 'server-only-key',
    fencingToken: 1,
    startedAt: '2026-09-18T00:00:00.000Z',
    expiresAt: '2026-09-18T00:01:00.000Z',
    stoppedAt: '2026-09-18T00:00:01.000Z',
    stopReason: 'SERVICE_UNAVAILABLE',
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: 1,
    traceId: 'server-only-trace',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:01.000Z',
    ...overrides,
  };
}
