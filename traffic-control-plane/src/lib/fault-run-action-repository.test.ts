import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeFaultRunActionSummary, toFaultRunAction } from './fault-run-action-repository';

test('action projection preserves dispatch ownership and parses bounded result summary', () => {
  const action = toFaultRunAction({
    action_id: '123e4567-e89b-12d3-a456-426614174000',
    fault_run_id: '123e4567-e89b-12d3-a456-426614174001',
    action_type: 'RELEASE',
    attempt_no: 1,
    action_state: 'DISPATCHING',
    requested_by: 'RECONCILER',
    request_idempotency_key: 'release-action-001',
    operator_audit_id: null,
    dispatch_owner_id: 'worker-a',
    dispatch_owner_epoch: 4,
    requested_at: '2026-09-21 01:00:00.000',
    dispatch_started_at: '2026-09-21 01:00:01.000',
    completed_at: null,
    result_summary_json: null,
    error_code: null,
    created_at: '2026-09-21 01:00:00.000',
    updated_at: '2026-09-21 01:00:01.000',
  });

  assert.equal(action.actionState, 'DISPATCHING');
  assert.equal(action.dispatchOwnerId, 'worker-a');
  assert.equal(action.dispatchOwnerEpoch, 4);
  assert.equal(action.resultSummary, null);
  assert.equal(Date.parse(action.requestedAt), Date.parse('2026-09-21T01:00:00+08:00'));
});

test('action summaries only persist low-cardinality allowlisted values', () => {
  assert.deepEqual(
    sanitizeFaultRunActionSummary({
      released: true,
      deletedBytes: 1024,
      operation: 'notification-storage',
    }),
    {
      released: true,
      deletedBytes: 1024,
      operation: 'notification-storage',
    },
  );
  assert.throws(
    () => sanitizeFaultRunActionSummary({ responseBody: 'must-not-persist' }),
    /INVALID_FAULT_RUN_ACTION_SUMMARY/,
  );
  assert.throws(
    () => sanitizeFaultRunActionSummary({ errorCode: 'contains\nraw details' }),
    /INVALID_FAULT_RUN_ACTION_SUMMARY/,
  );
});
