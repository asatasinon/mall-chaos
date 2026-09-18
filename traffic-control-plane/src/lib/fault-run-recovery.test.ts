import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialFaultRunRecoveryProjection,
  FaultRunRecoveryContractError,
  MAX_FAULT_RUN_RECOVERY_PROJECTION_BYTES,
  parseFaultRunRecoveryProjection,
  sanitizeFaultRunRecoveryError,
  selectDominantFaultRunRecoveryOutcome,
  selectMostRestrictiveFaultRunState,
  serializeFaultRunRecoveryProjection,
  type FaultRunRecoveryProjection,
} from './fault-run-recovery';

const requestedAt = '2026-09-17T10:00:00.000Z';
const drainAt = '2026-09-17T10:00:30.000Z';
const recoveryAt = '2026-09-17T10:01:00.000Z';
const requestKeyHash = 'a'.repeat(64);

function initialProjection(): FaultRunRecoveryProjection {
  return createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
    requestKeyHash,
  });
}

function verificationUnavailableProjection(): FaultRunRecoveryProjection {
  const initial = initialProjection();
  return {
    ...initial,
    phase: 'PARTIAL_RECOVERY',
    outcome: 'VERIFY_UNAVAILABLE',
    verification: {
      status: 'NOT_CONFIGURED',
      attempt: 1,
      startedAt: '2026-09-17T10:00:10.000Z',
      completedAt: '2026-09-17T10:00:10.000Z',
      errorCode: 'VERIFY_UNAVAILABLE',
    },
    residuals: [{
      kind: 'VERIFICATION_UNAVAILABLE',
      responsibility: 'CONTROL_PLANE',
      nextAction: 'CONFIGURE_VERIFICATION',
    }],
    lastError: {
      stage: 'VERIFY',
      code: 'VERIFY_UNAVAILABLE',
      retryable: false,
    },
  };
}

function clone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

test('creates and serializes a canonical initial safe-runtime projection', () => {
  const projection = initialProjection();
  const serialized = serializeFaultRunRecoveryProjection(projection);
  const parsed = parseFaultRunRecoveryProjection(JSON.parse(serialized));

  assert.equal(parsed.kind, 'SAFE_RUNTIME_V1');
  if (parsed.kind !== 'SAFE_RUNTIME_V1') return;
  assert.deepEqual(parsed.projection, projection);
  assert.equal(Buffer.byteLength(serialized, 'utf8') <= MAX_FAULT_RUN_RECOVERY_PROJECTION_BYTES, true);
  assert.deepEqual(Object.keys(JSON.parse(serialized)), [
    'schemaVersion',
    'phase',
    'outcome',
    'stop',
    'deadlines',
    'drain',
    'release',
    'cleanup',
    'verification',
    'residuals',
  ]);
});

test('allows expiry stops without a manual idempotency-key hash', () => {
  const projection = createInitialFaultRunRecoveryProjection({
    reason: 'EXPIRED',
    requestedAt,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
  });

  assert.equal(projection.stop.requestKeyHash, undefined);
  assert.equal(parseFaultRunRecoveryProjection(projection).kind, 'SAFE_RUNTIME_V1');
});

test('records service unavailability as a non-terminal recovery fact', () => {
  const projection = createInitialFaultRunRecoveryProjection({
    reason: 'SERVICE_UNAVAILABLE',
    requestedAt,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
  });

  assert.equal(projection.phase, 'PARTIAL_RECOVERY');
  assert.equal(projection.outcome, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(projection.residuals, [{
    kind: 'SERVICE_RECOVERY_REQUIRED',
    responsibility: 'SERVICE_OWNER',
    nextAction: 'WAIT_FOR_SERVICE_RECOVERY',
  }]);
  assert.equal(parseFaultRunRecoveryProjection(projection).kind, 'SAFE_RUNTIME_V1');
});

test('classifies historical recovery results without inferring success', () => {
  assert.deepEqual(parseFaultRunRecoveryProjection(null), { kind: 'ABSENT', projection: null });
  assert.deepEqual(parseFaultRunRecoveryProjection(undefined), { kind: 'ABSENT', projection: null });
  assert.deepEqual(parseFaultRunRecoveryProjection({ released: true }), { kind: 'LEGACY', projection: null });
  assert.deepEqual(
    parseFaultRunRecoveryProjection({ compensated: true, workerDrain: { drained: true } }),
    { kind: 'LEGACY', projection: null },
  );
  assert.deepEqual(
    parseFaultRunRecoveryProjection({
      schemaVersion: 'legacy.v1',
      stopped: true,
    }),
    { kind: 'UNKNOWN', projection: null, reason: 'UNKNOWN_SCHEMA' },
  );
});

test('rejects unknown fields, malformed values, and contradictory facts', () => {
  const rawProjection = clone(initialProjection());
  rawProjection.targetResponse = { body: 'must not persist' };
  assert.deepEqual(
    parseFaultRunRecoveryProjection(rawProjection),
    { kind: 'UNKNOWN', projection: null, reason: 'INVALID_SHAPE' },
  );

  const nestedRawField = clone(initialProjection());
  (nestedRawField.drain as Record<string, unknown>).message = 'raw error';
  assert.deepEqual(
    parseFaultRunRecoveryProjection(nestedRawField),
    { kind: 'UNKNOWN', projection: null, reason: 'INVALID_SHAPE' },
  );

  const negativeCounter = clone(initialProjection());
  negativeCounter.drain = {
    status: 'RUNNING',
    attempt: 1,
    startedAt: requestedAt,
    metrics: { accepted: -1 },
  };
  assert.deepEqual(
    parseFaultRunRecoveryProjection(negativeCounter),
    { kind: 'UNKNOWN', projection: null, reason: 'INVALID_SHAPE' },
  );

  const contradictory = clone(verificationUnavailableProjection());
  contradictory.phase = 'COMPLETED';
  assert.deepEqual(
    parseFaultRunRecoveryProjection(contradictory),
    { kind: 'UNKNOWN', projection: null, reason: 'INVALID_INVARIANT' },
  );

  assert.deepEqual(
    parseFaultRunRecoveryProjection(['safe-runtime.v1']),
    { kind: 'UNKNOWN', projection: null, reason: 'NOT_AN_OBJECT' },
  );
});

test('persists verification unavailability as a valid non-successful projection', () => {
  const projection = verificationUnavailableProjection();
  const parsed = parseFaultRunRecoveryProjection(projection);

  assert.equal(parsed.kind, 'SAFE_RUNTIME_V1');
  assert.equal(projection.outcome, 'VERIFY_UNAVAILABLE');
  assert.equal(projection.phase, 'PARTIAL_RECOVERY');
  assert.equal(
    selectDominantFaultRunRecoveryOutcome(['SUCCEEDED', 'VERIFY_UNAVAILABLE']),
    'VERIFY_UNAVAILABLE',
  );
});

test('serializer rejects invalid typed objects rather than stripping them', () => {
  const projection = {
    ...initialProjection(),
    unexpected: 'must not be silently dropped',
  };

  assert.throws(
    () => serializeFaultRunRecoveryProjection(projection),
    (error: unknown) => error instanceof FaultRunRecoveryContractError
      && error.code === 'RECOVERY_PROJECTION_INVALID',
  );
});

test('sanitizes only an allowlisted failure kind and never reads raw error details', () => {
  const rawError = new Error('database password and target response must never persist');
  const sanitized = sanitizeFaultRunRecoveryError('RELEASE', rawError);
  assert.deepEqual(sanitized, {
    stage: 'RELEASE',
    code: 'TARGET_RELEASE_FAILED',
    retryable: false,
  });

  const unavailable = sanitizeFaultRunRecoveryError('VERIFY', {
    kind: 'NOT_CONFIGURED',
    message: 'raw target response',
    stack: 'raw stack',
    response: { secret: 'value' },
  });
  assert.deepEqual(unavailable, {
    stage: 'VERIFY',
    code: 'VERIFY_UNAVAILABLE',
    retryable: false,
  });
  assert.deepEqual(Object.keys(unavailable), ['stage', 'code', 'retryable']);
});

test('uses deterministic, conservative outcome and top-level-state priority', () => {
  assert.equal(selectDominantFaultRunRecoveryOutcome([]), 'PENDING');
  assert.equal(
    selectDominantFaultRunRecoveryOutcome(['RELEASE_FAILED', 'WORKER_FAILED']),
    'WORKER_FAILED',
  );
  assert.equal(
    selectDominantFaultRunRecoveryOutcome(['VERIFY_UNAVAILABLE', 'SERVICE_UNAVAILABLE']),
    'SERVICE_UNAVAILABLE',
  );
  assert.equal(
    selectMostRestrictiveFaultRunState(['RECOVERED', 'ACTIVE', 'RECOVERING']),
    'RECOVERING',
  );
  assert.equal(selectMostRestrictiveFaultRunState([]), null);
});
