import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { closePool, getPool } from './db';
import {
  claimFaultRunExecution,
  heartbeatFaultRunExecution,
  loadFaultRunExecution,
  markFaultRunExecutionLeaseLost,
  relinquishFaultRunExecution,
  updateOwnedFaultRunExecution,
} from './fault-run-execution-repository';

const enabled = process.env.RUN_MYSQL_INTEGRATION === 'true';

test('execution lease rejects stale owners and advances epoch after relinquish', {
  skip: enabled ? false : 'Set RUN_MYSQL_INTEGRATION=true against a disposable control-plane database',
}, async () => {
  const pool = getPool();
  const runId = randomUUID();
  const idempotencyKey = `p2-02-integration-${runId}`;
  try {
    const [activeRows] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM fault_runs
        WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
    );
    const activeCount = Number((activeRows as Record<string, unknown>[])[0]?.count ?? 0);
    if (activeCount !== 0) throw new Error('EXECUTION_LEASE_TEST_REQUIRES_NO_ACTIVE_RUN');

    await pool.execute(
      `INSERT INTO fault_runs
        (fault_run_id, scenario, target_service, target_operation, state, parameters_json,
         idempotency_key, fencing_token, expires_at, trace_id)
       VALUES (?, 'BROWSE_REPORT_SQL', 'catalog-service', 'products-browse-report',
               'ACTIVE', ?, ?, 999999999, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND), ?)`,
      [runId, JSON.stringify({ durationSec: 60 }), idempotencyKey, `trace-${runId}`],
    );
    await pool.execute(
      `INSERT INTO fault_run_executions (fault_run_id, execution_mode)
       VALUES (?, 'TAKEOVER')`,
      [runId],
    );

    const claims = await Promise.all([
      claimFaultRunExecution({
        faultRunId: runId,
        executionMode: 'TAKEOVER',
        ownerId: 'integration-owner-a',
        leaseTtlMs: 30_000,
        reconciliationState: 'OWNED',
        lastAction: 'OWNER_LEASE_ACQUIRED',
      }),
      claimFaultRunExecution({
        faultRunId: runId,
        executionMode: 'TAKEOVER',
        ownerId: 'integration-owner-b',
        leaseTtlMs: 30_000,
        reconciliationState: 'OWNED',
        lastAction: 'OWNER_LEASE_ACQUIRED',
      }),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const first = claims.find(Boolean);
    assert.equal(first?.ownerEpoch, 1);

    assert.equal(await heartbeatFaultRunExecution({
      faultRunId: runId,
      ownerId: 'integration-owner-a',
      ownerEpoch: 99,
      leaseTtlMs: 30_000,
    }), false);

    const ownerId = first!.ownerId!;
    assert.equal(await updateOwnedFaultRunExecution({
      faultRunId: runId,
      ownerId,
      ownerEpoch: first!.ownerEpoch,
      drainState: 'DRAINED',
      lastAction: 'TEST_DRAINED',
    }), true);
    assert.equal(await relinquishFaultRunExecution({
      faultRunId: runId,
      ownerId,
      ownerEpoch: first!.ownerEpoch,
    }), true);

    const takeover = await claimFaultRunExecution({
      faultRunId: runId,
      executionMode: 'TAKEOVER',
      ownerId: 'integration-owner-c',
      leaseTtlMs: 30_000,
      reconciliationState: 'TAKEN_OVER',
      lastAction: 'OWNER_TAKEOVER_COMPLETED',
    });
    assert.equal(takeover?.ownerEpoch, 2);
    assert.equal(await heartbeatFaultRunExecution({
      faultRunId: runId,
      ownerId,
      ownerEpoch: first!.ownerEpoch,
      leaseTtlMs: 30_000,
    }), false);
    assert.equal(await heartbeatFaultRunExecution({
      faultRunId: runId,
      ownerId: 'integration-owner-c',
      ownerEpoch: 2,
      leaseTtlMs: 30_000,
    }), true);
    await pool.execute(
      `UPDATE fault_run_executions
          SET lease_expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND)
        WHERE fault_run_id = ?`,
      [runId],
    );
    assert.equal(await updateOwnedFaultRunExecution({
      faultRunId: runId,
      ownerId: 'integration-owner-c',
      ownerEpoch: 2,
      drainState: 'DRAINED',
    }), false);
    assert.equal(await relinquishFaultRunExecution({
      faultRunId: runId,
      ownerId: 'integration-owner-c',
      ownerEpoch: 2,
    }), false);
    assert.equal(await markFaultRunExecutionLeaseLost({
      faultRunId: runId,
      ownerId: 'integration-owner-c',
      ownerEpoch: 2,
      errorCode: 'HEARTBEAT_REJECTED',
    }), true);
    const lost = await loadFaultRunExecution(runId);
    assert.equal(lost?.drainState, 'LEASE_LOST');
    assert.equal(lost?.reconciliationState, 'TAKEOVER_PENDING');
  } finally {
    await pool.query('DELETE FROM fault_runs WHERE fault_run_id = ?', [runId]).catch(() => undefined);
    await closePool();
  }
});
