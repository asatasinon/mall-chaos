import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveFaultRunRecoveryCompletionState,
  FaultRunCommandError,
  hashFaultRunCommandIdempotencyKey,
  isRunnableFaultRun,
  mergeFaultRunRecoveryStep,
  planFaultRunStop,
  startFaultRunManualCleanup,
  type FaultRunRecord,
} from './fault-run-repository';
import {
  createInitialFaultRunRecoveryProjection,
  parseFaultRunRecoveryProjection,
  type FaultRunRecoveryProjection,
} from './fault-run-recovery';

const requestedAt = '2026-09-17T10:00:00.000Z';
const drainAt = '2026-09-17T10:00:30.000Z';
const recoveryAt = '2026-09-17T10:01:00.000Z';
const completedAt = '2026-09-17T10:00:10.000Z';

function createRun(overrides: Partial<FaultRunRecord> = {}): FaultRunRecord {
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174000',
    scenario: 'BROWSE_REPORT_SQL',
    targetService: 'catalog-service',
    targetOperation: 'products-browse-report',
    state: 'ACTIVE',
    parameters: { durationSec: 60 },
    idempotencyKey: 'create-request-001',
    fencingToken: 1,
    startedAt: requestedAt,
    expiresAt: '2026-09-17T10:10:00.000Z',
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-1',
    createdAt: requestedAt,
    updatedAt: requestedAt,
    ...overrides,
  };
}

function initialProjection(): FaultRunRecoveryProjection {
  return createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
    requestKeyHash: hashFaultRunCommandIdempotencyKey('stop-request-001'),
  });
}

function retryableReleaseFailureProjection(): FaultRunRecoveryProjection {
  const initial = initialProjection();
  return {
    ...initial,
    phase: 'PARTIAL_RECOVERY',
    outcome: 'RELEASE_FAILED',
    drain: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    release: {
      status: 'FAILED',
      attempt: 1,
      startedAt: completedAt,
      completedAt,
      errorCode: 'TARGET_RELEASE_UNAVAILABLE',
    },
    residuals: [],
    lastError: {
      stage: 'RELEASE',
      code: 'TARGET_RELEASE_UNAVAILABLE',
      retryable: true,
    },
  };
}

test('treats only ACTIVE records as runnable', () => {
  for (const state of ['CREATING', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'] as const) {
    assert.equal(isRunnableFaultRun(createRun({ state })), false);
  }
  assert.equal(isRunnableFaultRun(createRun()), true);
});

test('plans a durable stop command without persisting a raw idempotency key', () => {
  const requestKeyHash = hashFaultRunCommandIdempotencyKey('stop-request-001');
  const plan = planFaultRunStop(createRun(), {
    reason: 'MANUAL',
    requestKeyHash,
    requestedAt: new Date(requestedAt),
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  assert.equal(plan.disposition, 'ACCEPTED');
  assert.equal(plan.projection?.stop.requestKeyHash, requestKeyHash);
  assert.notEqual(plan.projection?.stop.requestKeyHash, 'stop-request-001');
  assert.equal(plan.projection?.deadlines.drainAt, drainAt);
  assert.equal(plan.projection?.deadlines.recoveryAt, recoveryAt);
});

test('replays an identical stop command and rejects a pending command with a different key', () => {
  const projection = initialProjection();
  const run = createRun({ state: 'RECOVERING', recoveryResult: projection });
  const sameKey = planFaultRunStop(run, {
    reason: 'MANUAL',
    requestKeyHash: projection.stop.requestKeyHash,
    requestedAt: new Date(completedAt),
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });
  assert.equal(sameKey.disposition, 'REPLAYED');
  assert.throws(
    () => planFaultRunStop(run, {
      reason: 'MANUAL',
      requestKeyHash: hashFaultRunCommandIdempotencyKey('stop-request-002'),
      requestedAt: new Date(completedAt),
      drainTimeoutMs: 30_000,
      recoveryTimeoutMs: 60_000,
    }),
    (error: unknown) => error instanceof FaultRunCommandError
      && error.code === 'STOP_REQUEST_CONFLICT',
  );
});

test('creates a numbered retry only from an explicit retryable recovery boundary', () => {
  const failed = retryableReleaseFailureProjection();
  const retried = planFaultRunStop(createRun({
    state: 'RECOVERING',
    recoveryResult: failed,
    stopReason: 'MANUAL',
  }), {
    reason: 'MANUAL',
    requestKeyHash: hashFaultRunCommandIdempotencyKey('stop-request-002'),
    requestedAt: new Date('2026-09-17T10:02:00.000Z'),
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  assert.equal(retried.disposition, 'ACCEPTED');
  assert.equal(retried.projection?.stop.attempt, 2);
  assert.equal(retried.projection?.stop.reason, 'MANUAL');
  assert.equal(retried.projection?.deadlines.drainAt, '2026-09-17T10:02:30.000Z');
});

test('returns a terminal record without scheduling another stop command', () => {
  const terminal = planFaultRunStop(createRun({ state: 'STOPPED', recoveryResult: initialProjection() }), {
    reason: 'MANUAL',
    requestKeyHash: hashFaultRunCommandIdempotencyKey('stop-request-002'),
    requestedAt: new Date(completedAt),
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  assert.deepEqual(terminal, {
    disposition: 'TERMINAL',
    projection: initialProjection(),
  });
});

test('permits one legal recovery-step transition and rejects out-of-order work', () => {
  const initial = initialProjection();
  assert.throws(
    () => mergeFaultRunRecoveryStep(initial, {
      stage: 'RELEASE',
      step: { status: 'RUNNING', attempt: 1, startedAt: requestedAt },
      phase: 'RELEASING',
      outcome: 'PENDING',
      residuals: [],
    }),
    (error: unknown) => error instanceof FaultRunCommandError
      && error.code === 'RECOVERY_STEP_TRANSITION_INVALID',
  );

  const draining = mergeFaultRunRecoveryStep(initial, {
    stage: 'DRAIN',
    step: { status: 'RUNNING', attempt: 1, startedAt: requestedAt },
    phase: 'DRAINING',
    outcome: 'PENDING',
    residuals: [],
  });
  assert.equal(parseFaultRunRecoveryProjection(draining).kind, 'SAFE_RUNTIME_V1');

  const drained = mergeFaultRunRecoveryStep(draining, {
    stage: 'DRAIN',
    step: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    phase: 'RELEASING',
    outcome: 'PENDING',
    residuals: [],
  });
  assert.equal(drained.drain.status, 'SUCCEEDED');
});

test('does not turn an unconfigured verification policy into a terminal state', () => {
  const initial = initialProjection();
  const nominallyCompleted: FaultRunRecoveryProjection = {
    ...initial,
    phase: 'COMPLETED',
    outcome: 'SUCCEEDED',
    drain: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    release: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    cleanup: { status: 'NOT_APPLICABLE', attempt: 0 },
    verification: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    residuals: [],
  };

  assert.equal(
    deriveFaultRunRecoveryCompletionState(createRun(), nominallyCompleted),
    'RECOVERING',
  );
});

test('turns an accepted manual cleanup request into a separately durable pending step', () => {
  const initial = initialProjection();
  const manualCleanupRequired: FaultRunRecoveryProjection = {
    ...initial,
    phase: 'MANUAL_CLEANUP_REQUIRED',
    outcome: 'MANUAL_CLEANUP_REQUIRED',
    drain: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    release: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
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

  const pendingCleanup = startFaultRunManualCleanup(
    manualCleanupRequired,
    hashFaultRunCommandIdempotencyKey('cleanup-request-001'),
    new Date('2026-09-17T10:00:20.000Z'),
  );
  assert.equal(pendingCleanup.phase, 'CLEANING');
  assert.equal(pendingCleanup.outcome, 'PENDING');
  assert.equal(pendingCleanup.cleanup.status, 'RUNNING');
  assert.equal(pendingCleanup.cleanup.requestKeyHash, hashFaultRunCommandIdempotencyKey('cleanup-request-001'));
  assert.equal(pendingCleanup.lastError, undefined);
});
