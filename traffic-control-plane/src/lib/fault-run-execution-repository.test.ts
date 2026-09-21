import assert from 'node:assert/strict';
import test from 'node:test';
import { toExecutionRecord } from './fault-run-execution-repository';

test('execution projection parses nullable MySQL fields without inventing owner state', () => {
  const record = toExecutionRecord({
    fault_run_id: '123e4567-e89b-12d3-a456-426614174000',
    execution_mode: 'OBSERVE',
    owner_id: null,
    owner_epoch: 0,
    lease_acquired_at: null,
    lease_expires_at: null,
    last_heartbeat_at: null,
    lease_lost_at: null,
    reconciled_at: null,
    reconciliation_state: 'IDLE',
    drain_state: 'IDLE',
    drain_deadline_at: null,
    last_action: null,
    last_action_at: null,
    last_error_code: null,
    created_at: '2026-09-21 01:00:00.000',
    updated_at: '2026-09-21 01:00:00.000',
  });

  assert.equal(record.ownerId, null);
  assert.equal(record.ownerEpoch, 0);
  assert.equal(record.leaseAcquiredAt, null);
  assert.equal(record.reconciliationState, 'IDLE');
  assert.equal(record.drainState, 'IDLE');
  assert.equal(Date.parse(record.createdAt), Date.parse('2026-09-21T01:00:00+08:00'));
});
