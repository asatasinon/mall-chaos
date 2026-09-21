import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { closePool, getPool } from './db';
import {
  claimFaultRunAction,
  createFaultRunAction,
  listFaultRunActions,
  markStaleFaultRunActionUnknown,
} from './fault-run-action-repository';

const enabled = process.env.RUN_MYSQL_INTEGRATION === 'true';

test('action journal preserves idempotency and marks stale dispatch unknown', {
  skip: enabled ? false : 'Set RUN_MYSQL_INTEGRATION=true against a disposable control-plane database',
}, async () => {
  const pool = getPool();
  const runId = randomUUID();
  const idempotencyKey = `p2-03-action-${runId}`;
  try {
    const [activeRows] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM fault_runs
        WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
    );
    if (Number((activeRows as Record<string, unknown>[])[0]?.count ?? 0) !== 0) {
      throw new Error('ACTION_JOURNAL_TEST_REQUIRES_NO_ACTIVE_RUN');
    }

    await pool.execute(
      `INSERT INTO fault_runs
        (fault_run_id, scenario, target_service, target_operation, state, parameters_json,
         idempotency_key, fencing_token, expires_at, trace_id)
       VALUES (?, 'BROWSE_REPORT_SQL', 'catalog-service', 'products-browse-report',
               'ACTIVE', ?, ?, 999999995, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND), ?)`,
      [runId, JSON.stringify({ durationSec: 60 }), idempotencyKey, `trace-${runId}`],
    );
    await pool.execute(
      `INSERT INTO fault_run_executions (fault_run_id, execution_mode)
       VALUES (?, 'TAKEOVER')`,
      [runId],
    );

    const first = await createFaultRunAction({
      faultRunId: runId,
      actionType: 'RELEASE',
      requestedBy: 'RECONCILER',
      requestIdempotencyKey: `release-${runId}`,
    });
    const replay = await createFaultRunAction({
      faultRunId: runId,
      actionType: 'RELEASE',
      requestedBy: 'RECONCILER',
      requestIdempotencyKey: `release-${runId}`,
    });
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.action.actionId, first.action.actionId);

    const claimed = await claimFaultRunAction({
      actionId: first.action.actionId,
      ownerId: 'action-owner-a',
      ownerEpoch: 1,
    });
    assert.equal(claimed?.actionState, 'DISPATCHING');
    assert.equal(await claimFaultRunAction({
      actionId: first.action.actionId,
      ownerId: 'action-owner-b',
      ownerEpoch: 1,
    }), null);

    await pool.execute(
      `UPDATE fault_run_executions
          SET lease_expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND)
        WHERE fault_run_id = ?`,
      [runId],
    );
    assert.equal(await markStaleFaultRunActionUnknown({
      actionId: first.action.actionId,
      dispatchOwnerId: 'action-owner-a',
      dispatchOwnerEpoch: 1,
      errorCode: 'OWNER_LEASE_EXPIRED',
    }), true);
    const actions = await listFaultRunActions(runId);
    assert.equal(actions[0]?.actionState, 'OUTCOME_UNKNOWN');
    assert.equal(actions[0]?.errorCode, 'OWNER_LEASE_EXPIRED');
  } finally {
    await pool.query('DELETE FROM fault_runs WHERE fault_run_id = ?', [runId]).catch(() => undefined);
    await closePool();
  }
});
