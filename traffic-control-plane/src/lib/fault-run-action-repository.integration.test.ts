import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { closePool, getPool } from './db';
import {
  claimFaultRunAction,
  confirmFaultRunAction,
  createFaultRunAction,
  listFaultRunActions,
  markOwnedFaultRunActionUnknown,
  markStaleFaultRunActionUnknown,
} from './fault-run-action-repository';
import { claimFaultRunExecution, updateOwnedFaultRunExecution } from './fault-run-execution-repository';
import {
  activateOwnedCreatingRun,
  createFaultRun,
  finishOwnedFaultRunAction,
  loadFaultRun,
  loadFaultRunEvents,
  IdempotencyKeyReuseError,
  recordFaultRunRecoveryStep,
  requestFaultRunManualCleanup,
  requestFaultRunStop,
  settleOwnedFaultRunRecoveryAction,
  startOwnedFaultRunRelease,
} from './fault-run-repository';
import { getScenarioDefinition, validateScenarioParameters } from './fault-run-catalog';
import { parseFaultRunRecoveryProjection } from './fault-run-recovery';

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

    const owner = await claimFaultRunExecution({
      faultRunId: runId,
      executionMode: 'TAKEOVER',
      ownerId: 'action-owner-a',
      leaseTtlMs: 30_000,
      reconciliationState: 'OWNED',
      lastAction: 'OWNER_LEASE_ACQUIRED',
    });
    assert.equal(owner?.ownerEpoch, 1);
    assert.equal(await claimFaultRunAction({
      actionId: first.action.actionId,
      ownerId: 'action-owner-b',
      ownerEpoch: 1,
    }), null);
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
    assert.equal(await confirmFaultRunAction({
      actionId: first.action.actionId,
      ownerId: 'action-owner-b',
      ownerEpoch: 1,
      resultSummary: { released: true },
    }), false);
    assert.equal(await confirmFaultRunAction({
      actionId: first.action.actionId,
      ownerId: 'action-owner-a',
      ownerEpoch: 2,
      resultSummary: { released: true },
    }), false);

    await pool.execute(
      `UPDATE fault_run_executions
          SET lease_expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND)
        WHERE fault_run_id = ?`,
      [runId],
    );
    assert.equal(await confirmFaultRunAction({
      actionId: first.action.actionId,
      ownerId: 'action-owner-a',
      ownerEpoch: 1,
      resultSummary: { released: true },
    }), false);
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

test('owner-fenced recovery action unknown atomically requires manual intervention', {
  skip: enabled ? false : 'Set RUN_MYSQL_INTEGRATION=true against a disposable control-plane database',
}, async () => {
  const pool = getPool();
  const runId = randomUUID();
  const ownerId = `unknown-owner-${runId}`;
  try {
    const [activeRows] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM fault_runs
        WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
    );
    if (Number((activeRows as Record<string, unknown>[])[0]?.count ?? 0) !== 0) {
      throw new Error('ACTION_UNKNOWN_TEST_REQUIRES_NO_ACTIVE_RUN');
    }
    await pool.execute(
      `INSERT INTO fault_runs
        (fault_run_id, scenario, target_service, target_operation, state, parameters_json,
         idempotency_key, fencing_token, expires_at, trace_id)
       VALUES (?, 'BROWSE_REPORT_SQL', 'catalog-service', 'products-browse-report',
               'ACTIVE', ?, ?, 999999993, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND), ?)`,
      [runId, JSON.stringify({ durationSec: 60 }), `unknown-${runId}`, `trace-${runId}`],
    );
    await pool.execute(
      `INSERT INTO fault_run_executions (fault_run_id, execution_mode)
       VALUES (?, 'TAKEOVER')`,
      [runId],
    );
    const action = await createFaultRunAction({
      faultRunId: runId,
      actionType: 'RELEASE',
      requestedBy: 'RECONCILER',
      requestIdempotencyKey: `release-unknown-${runId}`,
    });
    const owner = await claimFaultRunExecution({
      faultRunId: runId,
      executionMode: 'TAKEOVER',
      ownerId,
      leaseTtlMs: 30_000,
      reconciliationState: 'OWNED',
      lastAction: 'OWNER_LEASE_ACQUIRED',
    });
    assert.equal(owner?.ownerEpoch, 1);
    assert.equal((await claimFaultRunAction({
      actionId: action.action.actionId,
      ownerId,
      ownerEpoch: 1,
    }))?.actionState, 'DISPATCHING');
    assert.equal(await markOwnedFaultRunActionUnknown({
      actionId: action.action.actionId,
      actionType: 'RELEASE',
      ownerId,
      ownerEpoch: 1,
      errorCode: 'GATEWAY_TIMEOUT',
    }), true);
    assert.equal((await listFaultRunActions(runId))[0]?.actionState, 'OUTCOME_UNKNOWN');
    const [executionRows] = await pool.query(
      `SELECT reconciliation_state
         FROM fault_run_executions
        WHERE fault_run_id = ?`,
      [runId],
    );
    assert.equal((executionRows as Record<string, unknown>[])[0]?.reconciliation_state,
      'MANUAL_INTERVENTION_REQUIRED');
    assert.ok((await loadFaultRunEvents(runId)).some((event) =>
      event.eventType === 'ACTION_OUTCOME_UNKNOWN'));
  } finally {
    await pool.query('DELETE FROM fault_runs WHERE fault_run_id = ?', [runId]).catch(() => undefined);
    await closePool();
  }
});

test('create transaction persists one PREPARE intent only when the catalog requires it', {
  skip: enabled ? false : 'Set RUN_MYSQL_INTEGRATION=true against a disposable control-plane database',
}, async () => {
  const pool = getPool();
  const runIds: string[] = [];
  try {
    const [activeRows] = await pool.query(
      `SELECT COUNT(*) AS count FROM fault_runs WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
    );
    if (Number((activeRows as Record<string, unknown>[])[0]?.count ?? 0) !== 0) {
      throw new Error('ACTION_JOURNAL_TEST_REQUIRES_NO_ACTIVE_RUN');
    }
    for (const [scenario, executionMode, expectedCount] of [
      ['BROWSE_REPORT_SQL', 'TAKEOVER', 1],
      ['BROWSE_SURGE', 'OBSERVE', 0],
      ['ORDER_REPORT_SQL', undefined, 0],
    ] as const) {
      const definition = getScenarioDefinition(scenario);
      const idempotencyKey = `p2-create-${randomUUID()}`;
      const input = {
        scenario, targetService: definition.targetService, targetOperation: definition.targetOperation,
        parameters: validateScenarioParameters(scenario, { durationSec: 60 }),
        idempotencyKey, expiresAt: new Date(Date.now() + 60_000), traceId: `trace-${randomUUID()}`,
        ...(executionMode ? { executionMode } : {}),
      };
      const result = await createFaultRun(input);
      runIds.push(result.run.faultRunId);
      assert.equal(result.run.state, 'CREATING');
      assert.equal(result.run.execution?.executionMode ?? null, executionMode ?? null);
      const actions = await listFaultRunActions(result.run.faultRunId);
      assert.equal(actions.length, expectedCount);
      assert.equal(result.action?.actionId ?? null, actions[0]?.actionId ?? null);
      const replay = await createFaultRun(input);
      assert.equal(replay.created, false);
      assert.equal(replay.action?.actionId ?? null, result.action?.actionId ?? null);
      assert.equal((await listFaultRunActions(result.run.faultRunId)).length, expectedCount);
      await assert.rejects(
        () => createFaultRun({ ...input, parameters: { ...input.parameters, durationSec: 61 } }),
        IdempotencyKeyReuseError,
      );
      if (executionMode) {
        const owner = await claimFaultRunExecution({
          faultRunId: result.run.faultRunId,
          executionMode,
          ownerId: `owner-${scenario}`,
          leaseTtlMs: 30_000,
          reconciliationState: 'OWNED',
          lastAction: 'OWNER_LEASE_ACQUIRED',
        });
        assert.equal(owner?.ownerEpoch, 1);
        if (result.action) {
          assert.equal(await claimFaultRunAction({
            actionId: result.action.actionId,
            ownerId: 'wrong-owner',
            ownerEpoch: 1,
          }), null);
          assert.equal((await claimFaultRunAction({
            actionId: result.action.actionId,
            ownerId: owner!.ownerId!,
            ownerEpoch: 1,
          }))?.actionState, 'DISPATCHING');
        }
        assert.equal(await activateOwnedCreatingRun({
          faultRunId: result.run.faultRunId,
          ownerId: owner!.ownerId!,
          ownerEpoch: 2,
          ...(result.action ? { prepareActionId: result.action.actionId } : {}),
        }), null);
        assert.equal((await activateOwnedCreatingRun({
          faultRunId: result.run.faultRunId,
          ownerId: owner!.ownerId!,
          ownerEpoch: 1,
          ...(result.action ? { prepareActionId: result.action.actionId } : {}),
        }))?.state, 'ACTIVE');
        assert.equal((await listFaultRunActions(result.run.faultRunId))[0]?.actionState ?? null,
          result.action ? 'CONFIRMED' : null);
      }
      await pool.query('DELETE FROM fault_runs WHERE fault_run_id = ?', [result.run.faultRunId]);
      runIds.pop();
    }
  } finally {
    for (const runId of runIds) {
      await pool.query('DELETE FROM fault_runs WHERE fault_run_id = ?', [runId]).catch(() => undefined);
    }
    await closePool();
  }
});

test('stopping a CREATING run cancels its undispatched PREPARE intent', {
  skip: enabled ? false : 'Set RUN_MYSQL_INTEGRATION=true against a disposable control-plane database',
}, async () => {
  const pool = getPool();
  let runId: string | null = null;
  try {
    const [activeRows] = await pool.query(
      `SELECT COUNT(*) AS count FROM fault_runs WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
    );
    if (Number((activeRows as Record<string, unknown>[])[0]?.count ?? 0) !== 0) {
      throw new Error('ACTION_JOURNAL_TEST_REQUIRES_NO_ACTIVE_RUN');
    }

    const scenario = 'BROWSE_REPORT_SQL';
    const definition = getScenarioDefinition(scenario);
    const created = await createFaultRun({
      scenario,
      targetService: definition.targetService,
      targetOperation: definition.targetOperation,
      parameters: validateScenarioParameters(scenario, { durationSec: 60 }),
      idempotencyKey: `p2-stop-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000),
      traceId: `trace-${randomUUID()}`,
      executionMode: 'TAKEOVER',
    });
    runId = created.run.faultRunId;
    assert.equal(created.action?.actionState, 'REQUESTED');

    const stopped = await requestFaultRunStop({
      faultRunId: runId,
      reason: 'WORKER_SHUTDOWN',
      drainTimeoutMs: 30_000,
      recoveryTimeoutMs: 60_000,
    });
    assert.equal(stopped?.run.state, 'RECOVERING');
    const actions = await listFaultRunActions(runId);
    assert.equal(actions[0]?.actionState, 'CANCELLED');
    assert.equal(actions[0]?.errorCode, 'PREPARE_CANCELLED_BEFORE_DISPATCH');
  } finally {
    if (runId) await pool.query('DELETE FROM fault_runs WHERE fault_run_id = ?', [runId]).catch(() => undefined);
    await closePool();
  }
});

test('release action settlement atomically updates the recovery projection under its owner epoch', {
  skip: enabled ? false : 'Set RUN_MYSQL_INTEGRATION=true against a disposable control-plane database',
}, async () => {
  const pool = getPool();
  const runId = randomUUID();
  const ownerId = `recovery-owner-${runId}`;
  const requestKey = `p2-stop-${runId}`;
  const releaseKey = `release-${runId}-1`;
  try {
    const [activeRows] = await pool.query(
      `SELECT COUNT(*) AS count FROM fault_runs WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
    );
    if (Number((activeRows as Record<string, unknown>[])[0]?.count ?? 0) !== 0) {
      throw new Error('RECOVERY_ACTION_TEST_REQUIRES_NO_ACTIVE_RUN');
    }

    await pool.execute(
      `INSERT INTO fault_runs
        (fault_run_id, scenario, target_service, target_operation, state, parameters_json,
         idempotency_key, fencing_token, expires_at, trace_id)
       VALUES (?, 'BROWSE_REPORT_SQL', 'catalog-service', 'products-browse-report',
               'ACTIVE', ?, ?, 999999995, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND), ?)`,
      [runId, JSON.stringify({ durationSec: 60 }), `create-${runId}`, `trace-${runId}`],
    );
    await pool.execute(
      `INSERT INTO fault_run_executions (fault_run_id, execution_mode) VALUES (?, 'TAKEOVER')`,
      [runId],
    );
    const stopped = await requestFaultRunStop({
      faultRunId: runId,
      reason: 'MANUAL',
      requestKey,
      audit: { operatorId: null, correlationId: `p2-stop-audit-${runId}` },
      drainTimeoutMs: 30_000,
      recoveryTimeoutMs: 60_000,
    });
    assert.equal(stopped?.run.state, 'RECOVERING');
    const attempt = stopped!.recovery.kind === 'SAFE_RUNTIME_V1'
      ? stopped!.recovery.projection.stop.attempt
      : 0;
    assert.equal(attempt, 1);

    const drainStartedAt = new Date().toISOString();
    await recordFaultRunRecoveryStep({
      faultRunId: runId,
      expectedAttempt: attempt,
      mutation: {
        stage: 'DRAIN',
        step: {
          status: 'RUNNING',
          attempt,
          startedAt: drainStartedAt,
          participantKinds: ['REPORT'],
        },
        phase: 'DRAINING',
        outcome: 'PENDING',
        residuals: [],
      },
      eventType: 'DRAIN_STARTED',
      eventPayload: { participant: 'REPORT' },
    });
    const drainCompletedAt = new Date().toISOString();
    await recordFaultRunRecoveryStep({
      faultRunId: runId,
      expectedAttempt: attempt,
      mutation: {
        stage: 'DRAIN',
        step: {
          status: 'SUCCEEDED',
          attempt,
          startedAt: drainStartedAt,
          completedAt: drainCompletedAt,
          participantKinds: ['REPORT'],
        },
        phase: 'RELEASING',
        outcome: 'PENDING',
        residuals: [],
      },
      eventType: 'DRAIN_COMPLETED',
      eventPayload: { participant: 'REPORT', completedAt: drainCompletedAt },
    });
    const owner = await claimFaultRunExecution({
      faultRunId: runId,
      executionMode: 'TAKEOVER',
      ownerId,
      leaseTtlMs: 30_000,
      reconciliationState: 'OWNED',
      lastAction: 'OWNER_LEASE_ACQUIRED',
    });
    assert.equal(owner?.ownerEpoch, 1);
    assert.equal(await updateOwnedFaultRunExecution({
      faultRunId: runId,
      ownerId,
      ownerEpoch: 1,
      drainState: 'DRAINED',
      lastAction: 'OWNER_DRAIN_COMPLETED',
    }), true);

    const releaseStartedAt = new Date().toISOString();
    const started = await startOwnedFaultRunRelease({
      faultRunId: runId,
      ownerId,
      ownerEpoch: 1,
      expectedAttempt: attempt,
      requestIdempotencyKey: releaseKey,
      mutation: {
        stage: 'RELEASE',
        step: { status: 'RUNNING', attempt, startedAt: releaseStartedAt },
        phase: 'RELEASING',
        outcome: 'PENDING',
        residuals: [],
      },
      eventPayload: { operation: 'products-browse-report' },
    });
    assert.ok(started);
    const wrongOwner = await claimFaultRunAction({
      actionId: started!.actionId,
      ownerId: 'wrong-recovery-owner',
      ownerEpoch: 1,
    });
    assert.equal(wrongOwner, null);
    const claimed = await claimFaultRunAction({
      actionId: started!.actionId,
      ownerId,
      ownerEpoch: 1,
    });
    assert.equal(claimed?.actionState, 'DISPATCHING');

    const completedAt = new Date().toISOString();
    const settled = await settleOwnedFaultRunRecoveryAction({
      faultRunId: runId,
      actionId: started!.actionId,
      actionType: 'RELEASE',
      requestIdempotencyKey: releaseKey,
      ownerId,
      ownerEpoch: 1,
      actionState: 'CONFIRMED',
      resultSummary: { released: true, operation: 'products-browse-report' },
      expectedAttempt: attempt,
      mutation: {
        stage: 'RELEASE',
        step: {
          status: 'SUCCEEDED',
          attempt,
          startedAt: releaseStartedAt,
          completedAt,
        },
        phase: 'RELEASING',
        outcome: 'PENDING',
        residuals: [],
      },
      eventType: 'RELEASE_COMPLETED',
      eventPayload: { operation: 'products-browse-report', completedAt },
    });
    assert.equal(settled?.state, 'RECOVERING');
    const projection = await loadFaultRun(runId);
    const recovery = parseFaultRunRecoveryProjection(projection?.recoveryResult);
    assert.equal(recovery.kind, 'SAFE_RUNTIME_V1');
    assert.equal(recovery.projection.release.status, 'SUCCEEDED');
    assert.equal((await listFaultRunActions(runId))[0]?.actionState, 'CONFIRMED');
    const events = await loadFaultRunEvents(runId);
    assert.deepEqual(events.map((event) => event.eventType).filter((type) =>
      ['RELEASE_STARTED', 'RELEASE_COMPLETED'].includes(type)), [
      'RELEASE_STARTED',
      'RELEASE_COMPLETED',
    ]);
  } finally {
    await pool.query(
      'DELETE FROM operator_audit_logs WHERE correlation_id = ?',
      [`p2-stop-audit-${runId}`],
    ).catch(() => undefined);
    await pool.query('DELETE FROM fault_runs WHERE fault_run_id = ?', [runId]).catch(() => undefined);
    await closePool();
  }
});

test('terminal operator cleanup is claimable and settles its action event under the owner lease', {
  skip: enabled ? false : 'Set RUN_MYSQL_INTEGRATION=true against a disposable control-plane database',
}, async () => {
  const pool = getPool();
  const runId = randomUUID();
  const ownerId = `terminal-cleanup-owner-${runId}`;
  try {
    const [activeRows] = await pool.query(
      `SELECT COUNT(*) AS count FROM fault_runs WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
    );
    if (Number((activeRows as Record<string, unknown>[])[0]?.count ?? 0) !== 0) {
      throw new Error('TERMINAL_CLEANUP_TEST_REQUIRES_NO_ACTIVE_RUN');
    }
    await pool.execute(
      `INSERT INTO fault_runs
        (fault_run_id, scenario, target_service, target_operation, state, parameters_json,
         idempotency_key, fencing_token, expires_at, recovery_result, trace_id)
       VALUES (?, 'CATALOG_REDIS_LARGE_VALUE', 'catalog-service', 'product-detail-cache',
               'RECOVERED', ?, ?, 999999994,
               DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND), JSON_OBJECT(), ?)`,
      [runId, JSON.stringify({ durationSec: 60 }), `terminal-${runId}`, `trace-${runId}`],
    );
    await pool.execute(
      `INSERT INTO fault_run_executions (fault_run_id, execution_mode, drain_state)
       VALUES (?, 'TAKEOVER', 'DRAINED')`,
      [runId],
    );
    const command = await requestFaultRunManualCleanup({
      faultRunId: runId,
      requestKey: `cleanup-${runId}`,
      audit: { operatorId: null, correlationId: `p2-cleanup-audit-${runId}` },
    });
    assert.equal(command?.disposition, 'ACCEPTED');
    const requested = (await listFaultRunActions(runId))[0];
    assert.equal(requested?.actionState, 'REQUESTED');

    const owner = await claimFaultRunExecution({
      faultRunId: runId,
      executionMode: 'TAKEOVER',
      ownerId,
      leaseTtlMs: 30_000,
      reconciliationState: 'OWNED',
      lastAction: 'OWNER_LEASE_ACQUIRED',
    });
    assert.equal(owner?.ownerEpoch, 1);
    assert.equal(owner?.drainState, 'DRAINED');
    assert.equal(await claimFaultRunExecution({
      faultRunId: runId,
      executionMode: 'TAKEOVER',
      ownerId: 'terminal-cleanup-owner-b',
      leaseTtlMs: 30_000,
      reconciliationState: 'TAKEN_OVER',
      lastAction: 'OWNER_TAKEOVER_COMPLETED',
    }), null);
    const claimed = await claimFaultRunAction({
      actionId: requested!.actionId,
      ownerId,
      ownerEpoch: 1,
    });
    assert.equal(claimed?.actionState, 'DISPATCHING');

    const completedAt = new Date().toISOString();
    assert.equal(await finishOwnedFaultRunAction({
      faultRunId: runId,
      actionId: requested!.actionId,
      actionType: 'CLEANUP',
      ownerId,
      ownerEpoch: 1,
      actionState: 'CONFIRMED',
      resultSummary: { cleaned: true },
      eventType: 'MANUAL_CLEANUP_COMPLETED',
      eventPayload: {
        operation: 'notification-storage',
        cleanupAttempt: 1,
        completedAt,
      },
    }), true);
    assert.equal((await listFaultRunActions(runId))[0]?.actionState, 'CONFIRMED');
    assert.equal((await loadFaultRun(runId))?.state, 'RECOVERED');
    assert.ok((await loadFaultRunEvents(runId)).some((event) =>
      event.eventType === 'MANUAL_CLEANUP_COMPLETED'));
  } finally {
    await pool.query(
      'DELETE FROM operator_audit_logs WHERE correlation_id = ?',
      [`p2-cleanup-audit-${runId}`],
    ).catch(() => undefined);
    await pool.query('DELETE FROM fault_runs WHERE fault_run_id = ?', [runId]).catch(() => undefined);
    await closePool();
  }
});
