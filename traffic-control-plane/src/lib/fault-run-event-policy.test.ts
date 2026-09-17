import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FaultRunEventPolicyError,
  MAX_FAULT_RUN_EVENT_PAYLOAD_BYTES,
  serializeFaultRunEventPayload,
} from './fault-run-event-policy';

test('bounds current event writes and keeps undefined payloads explicit', () => {
  assert.equal(serializeFaultRunEventPayload('RECOVERY_COMPLETED', undefined), '{}');
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(
    () => serializeFaultRunEventPayload('RECOVERY_COMPLETED', cyclic),
    (error: unknown) => error instanceof FaultRunEventPolicyError
      && error.message === 'EVENT_PAYLOAD_NOT_SERIALIZABLE',
  );
  assert.throws(
    () => serializeFaultRunEventPayload(
      'RECOVERY_COMPLETED',
      { detail: 'x'.repeat(MAX_FAULT_RUN_EVENT_PAYLOAD_BYTES) },
    ),
    (error: unknown) => error instanceof FaultRunEventPolicyError
      && error.message === 'EVENT_PAYLOAD_TOO_LARGE',
  );
});

test('rejects dynamic event names and retired per-request events', () => {
  assert.throws(
    () => serializeFaultRunEventPayload('SCENARIO_REQUEST_FAILED', { failureCode: 'WORKER_REQUEST_FAILED' }),
    (error: unknown) => error instanceof FaultRunEventPolicyError
      && error.message === 'RETIRED_HIGH_FREQUENCY_EVENT:SCENARIO_REQUEST_FAILED',
  );
  assert.throws(
    () => serializeFaultRunEventPayload('RECOVERY_COMPLETED:run-id', {}),
    (error: unknown) => error instanceof FaultRunEventPolicyError
      && error.message === 'INVALID_EVENT_TYPE',
  );
});
