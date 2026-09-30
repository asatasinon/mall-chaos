import assert from 'node:assert/strict';
import test from 'node:test';
import { createFaultRunContext, validateFaultRunContext } from './fault-run-context';
import type { FaultRunRecord } from './fault-run-repository';

const validContext = {
  faultRunId: '123e4567-e89b-12d3-a456-426614174000',
  expiresAt: '2026-08-26T12:00:00.000Z',
  fencingToken: 12,
  idempotencyKey: 'run-20260826-001',
};

test('accepts a valid unexpired context and rejects stale tokens', () => {
  assert.deepEqual(
    validateFaultRunContext(validContext, { now: new Date('2026-08-26T11:59:00.000Z') }),
    validContext,
  );
  assert.throws(
    () => validateFaultRunContext({ ...validContext, fencingToken: 0 }),
    /INVALID_FAULT_RUN_CONTEXT/,
  );
});

test('projects only the generic owner-fenced context from a revision-bearing Run', () => {
  const run: FaultRunRecord = {
    faultRunId: validContext.faultRunId,
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    state: 'ACTIVE',
    parameters: { durationSec: 60 },
    contractRevision: 'sc.v1:sha256:' + 'a'.repeat(64),
    idempotencyKey: validContext.idempotencyKey,
    fencingToken: validContext.fencingToken,
    startedAt: '2026-08-26T11:00:00.000Z',
    expiresAt: validContext.expiresAt,
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-context',
    createdAt: '2026-08-26T11:00:00.000Z',
    updatedAt: '2026-08-26T11:00:00.000Z',
  };
  const context = createFaultRunContext(run);

  assert.deepEqual(context, validContext);
  assert.equal('contractRevision' in context, false);
});

test('rejects expired context unless recovery explicitly allows it', () => {
  assert.throws(
    () => validateFaultRunContext(validContext, { now: new Date('2026-08-26T12:00:00.000Z') }),
    /FAULT_RUN_CONTEXT_EXPIRED/,
  );
  assert.deepEqual(
    validateFaultRunContext(validContext, {
      now: new Date('2026-08-26T12:00:00.000Z'),
      allowExpired: true,
    }),
    validContext,
  );
});
