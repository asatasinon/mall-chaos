import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerOwnerId, FaultRunOwnerFence } from './fault-run-owner-fence';

test('owner fence aborts once and rejects future work after lease loss', () => {
  const fence = new FaultRunOwnerFence(
    '123e4567-e89b-12d3-a456-426614174000',
    'worker-a',
    1,
  );
  let abortReason: unknown;
  fence.signal.addEventListener('abort', () => {
    abortReason = fence.signal.reason;
  });

  fence.assertLocallyCurrent();
  fence.lose('HEARTBEAT_REJECTED');
  fence.lose('SECOND_REASON');

  assert.equal(fence.isLocallyCurrent(), false);
  assert.equal(abortReason, 'HEARTBEAT_REJECTED');
  assert.throws(() => fence.assertLocallyCurrent(), /OWNER_LEASE_LOST/);
});

test('worker owner id is composed from bounded deployment identity parts', () => {
  assert.equal(
    createWorkerOwnerId('worker.release', 'pod-1', '123e4567-e89b-12d3-a456-426614174000'),
    'worker.release/pod-1/123e4567-e89b-12d3-a456-426614174000',
  );
  assert.throws(
    () => createWorkerOwnerId('x'.repeat(190), 'pod', '123e4567-e89b-12d3-a456-426614174000'),
    /OWNER_ID_TOO_LONG/,
  );
});
