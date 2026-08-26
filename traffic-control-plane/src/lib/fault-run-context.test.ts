import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFaultRunContext } from './fault-run-context';

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
