import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolConnection } from 'mysql2/promise';
import {
  deriveFaultRunRecoveryCompletionState,
  deleteExpiredFaultRunsWithConnection,
  FaultRunCommandError,
  hashFaultRunCommandIdempotencyKey,
  isRunnableFaultRun,
  mapFaultRunRow,
  mergeFaultRunRecoveryStep,
  planFaultRunStop,
  persistFaultRunCreateTransaction,
  startFaultRunManualCleanup,
  type CreateFaultRunInput,
  type FaultRunRecord,
} from './fault-run-repository';
import { getCatalogRevision } from './fault-run-catalog-revision';
import { createEvidenceCaptureSnapshot } from './evidence-types';
import { getScenarioDefinition } from './fault-run-catalog';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';
import { getScenarioContractRevision, resolveScenarioContract } from './scenario-contract';
import {
  createInitialFaultRunRecoveryProjection,
  parseFaultRunRecoveryProjection,
  type FaultRunRecoveryProjection,
} from './fault-run-recovery';

const requestedAt = '2026-09-17T10:00:00.000Z';
const drainAt = '2026-09-17T10:00:30.000Z';
const recoveryAt = '2026-09-17T10:01:00.000Z';
const completedAt = '2026-09-17T10:00:10.000Z';
const contractRevision = 'sc.v1:sha256:' + 'a'.repeat(64);

function createRun(overrides: Partial<FaultRunRecord> = {}): FaultRunRecord {
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174000',
    scenario: 'BROWSE_REPORT_SQL',
    targetService: 'catalog-service',
    targetOperation: 'products-browse-report',
    state: 'ACTIVE',
    parameters: { durationSec: 60 },
    contractRevision: 'sc.v1:sha256:' + '0'.repeat(64),
    idempotencyKey: 'create-request-001',
    fencingToken: 1,
    startedAt: requestedAt,
    expiresAt: '2026-09-17T10:10:00.000Z',
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-1',
    createdAt: requestedAt,
    updatedAt: requestedAt,
    ...overrides,
  };
}

function initialProjection(): FaultRunRecoveryProjection {
  return createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
    requestKeyHash: hashFaultRunCommandIdempotencyKey('stop-request-001'),
  });
}

function retryableReleaseFailureProjection(): FaultRunRecoveryProjection {
  const initial = initialProjection();
  return {
    ...initial,
    phase: 'PARTIAL_RECOVERY',
    outcome: 'RELEASE_FAILED',
    drain: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    release: {
      status: 'FAILED',
      attempt: 1,
      startedAt: completedAt,
      completedAt,
      errorCode: 'TARGET_RELEASE_UNAVAILABLE',
    },
    residuals: [],
    lastError: {
      stage: 'RELEASE',
      code: 'TARGET_RELEASE_UNAVAILABLE',
      retryable: true,
    },
  };
}

test('maps only a format-valid required contract revision from the row', () => {
  const row = {
    fault_run_id: '123e4567-e89b-12d3-a456-426614174000',
    scenario: 'BROWSE_REPORT_SQL',
    target_service: 'catalog-service',
    target_operation: 'products-browse-report',
    state: 'ACTIVE',
    parameters_json: JSON.stringify({ durationSec: 60 }),
    contract_revision: contractRevision,
    idempotency_key: 'create-request-001',
    fencing_token: 1,
    started_at: requestedAt,
    expires_at: '2026-09-17T10:10:00.000Z',
    stopped_at: null,
    stop_reason: null,
    recovery_result: null,
    recovery_error: null,
    operator_audit_id: null,
    trace_id: 'trace-1',
    created_at: requestedAt,
    updated_at: requestedAt,
  };

  assert.equal(mapFaultRunRow(row).contractRevision, contractRevision);
  assert.throws(
    () => mapFaultRunRow({ ...row, contract_revision: null }),
    /FAULT_RUN_CONTRACT_REVISION_INVALID/,
  );
  assert.throws(
    () => mapFaultRunRow({ ...row, contract_revision: 'not-a-revision' }),
    /FAULT_RUN_CONTRACT_REVISION_INVALID/,
  );
});

test('Fault Run, CREATED revision and frozen Evidence snapshot share one create transaction', async () => {
  const state = createFaultRunTransactionState();
  const connection = new FakeFaultRunCreateConnection(state);
  const input = createFaultRunCaptureInput();
  const created = await persistFaultRunCreateTransaction(
    connection as unknown as PoolConnection,
    input,
    '323e4567-e89b-12d3-a456-426614174002',
  );

  assert.deepEqual(created, { existingRunId: null, duplicateError: null });
  assert.equal(state.runs.length, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.snapshots.length, 1);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 0);
  const eventPayload = JSON.parse(String(state.events[0]?.payload)) as Record<string, unknown>;
  const snapshot = state.snapshots[0]!;
  assert.equal(eventPayload.contractRevision, input.contractRevision);
  assert.equal(snapshot.contract_revision, input.contractRevision);
  assert.equal(snapshot.contract_hash, input.evidenceCaptureSnapshot?.contractHash);
  assert.equal(snapshot.rendered_plan_hash, input.evidenceCaptureSnapshot?.renderedPlanHash);
  const eventInsert = state.queries.findIndex((query) => query.startsWith('INSERT INTO fault_run_events'));
  const snapshotInsert = state.queries.findIndex((query) =>
    query.startsWith('INSERT INTO evidence_contract_snapshots'));
  assert.ok(eventInsert >= 0 && snapshotInsert > eventInsert);

  const replay = await persistFaultRunCreateTransaction(
    connection as unknown as PoolConnection,
    input,
    '423e4567-e89b-12d3-a456-426614174003',
  );
  assert.deepEqual(replay, {
    existingRunId: '323e4567-e89b-12d3-a456-426614174002',
    duplicateError: null,
  });
  assert.equal(state.runs.length, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.snapshots.length, 1);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 1);
});

test('snapshot insert and validation failures roll back Run and CREATED event together', async () => {
  for (const failSnapshotInsert of [true, false]) {
    const state = createFaultRunTransactionState({ failSnapshotInsert });
    const connection = new FakeFaultRunCreateConnection(state);
    const input = createFaultRunCaptureInput();
    const invalidInput = failSnapshotInsert
      ? input
      : {
        ...input,
        evidenceCaptureSnapshot: {
          ...input.evidenceCaptureSnapshot!,
          renderedPlan: {
            ...input.evidenceCaptureSnapshot!.renderedPlan,
            rendererRevision: 'unsupported',
          },
        },
      };

    await assert.rejects(
      persistFaultRunCreateTransaction(
        connection as unknown as PoolConnection,
        invalidInput,
        '523e4567-e89b-12d3-a456-426614174004',
      ),
      failSnapshotInsert ? /FAKE_EVIDENCE_SNAPSHOT_WRITE_FAILED/u : /EVIDENCE_RENDERED_PLAN_INVALID/u,
    );
    assert.equal(state.runs.length, 0);
    assert.equal(state.events.length, 0);
    assert.equal(state.snapshots.length, 0);
    assert.equal(state.sequence, 0);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 1);
  }
});

test('treats only ACTIVE records as runnable', () => {
  for (const state of ['CREATING', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'] as const) {
    assert.equal(isRunnableFaultRun(createRun({ state })), false);
  }
  assert.equal(isRunnableFaultRun(createRun()), true);
});

test('plans a durable stop command without persisting a raw idempotency key', () => {
  const requestKeyHash = hashFaultRunCommandIdempotencyKey('stop-request-001');
  const plan = planFaultRunStop(createRun(), {
    reason: 'MANUAL',
    requestKeyHash,
    requestedAt: new Date(requestedAt),
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  assert.equal(plan.disposition, 'ACCEPTED');
  assert.equal(plan.projection?.stop.requestKeyHash, requestKeyHash);
  assert.notEqual(plan.projection?.stop.requestKeyHash, 'stop-request-001');
  assert.equal(plan.projection?.deadlines.drainAt, drainAt);
  assert.equal(plan.projection?.deadlines.recoveryAt, recoveryAt);
});

test('replays an identical stop command and rejects a pending command with a different key', () => {
  const projection = initialProjection();
  const run = createRun({ state: 'RECOVERING', recoveryResult: projection });
  const sameKey = planFaultRunStop(run, {
    reason: 'MANUAL',
    requestKeyHash: projection.stop.requestKeyHash,
    requestedAt: new Date(completedAt),
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });
  assert.equal(sameKey.disposition, 'REPLAYED');
  assert.throws(
    () => planFaultRunStop(run, {
      reason: 'MANUAL',
      requestKeyHash: hashFaultRunCommandIdempotencyKey('stop-request-002'),
      requestedAt: new Date(completedAt),
      drainTimeoutMs: 30_000,
      recoveryTimeoutMs: 60_000,
    }),
    (error: unknown) => error instanceof FaultRunCommandError
      && error.code === 'STOP_REQUEST_CONFLICT',
  );
});

test('creates a numbered retry only from an explicit retryable recovery boundary', () => {
  const failed = retryableReleaseFailureProjection();
  const retried = planFaultRunStop(createRun({
    state: 'RECOVERING',
    recoveryResult: failed,
    stopReason: 'MANUAL',
  }), {
    reason: 'MANUAL',
    requestKeyHash: hashFaultRunCommandIdempotencyKey('stop-request-002'),
    requestedAt: new Date('2026-09-17T10:02:00.000Z'),
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  assert.equal(retried.disposition, 'ACCEPTED');
  assert.equal(retried.projection?.stop.attempt, 2);
  assert.equal(retried.projection?.stop.reason, 'MANUAL');
  assert.equal(retried.projection?.deadlines.drainAt, '2026-09-17T10:02:30.000Z');
});

test('returns a terminal record without scheduling another stop command', () => {
  const terminal = planFaultRunStop(createRun({ state: 'STOPPED', recoveryResult: initialProjection() }), {
    reason: 'MANUAL',
    requestKeyHash: hashFaultRunCommandIdempotencyKey('stop-request-002'),
    requestedAt: new Date(completedAt),
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
  });

  assert.deepEqual(terminal, {
    disposition: 'TERMINAL',
    projection: initialProjection(),
  });
});

test('permits one legal recovery-step transition and rejects out-of-order work', () => {
  const initial = initialProjection();
  assert.throws(
    () => mergeFaultRunRecoveryStep(initial, {
      stage: 'RELEASE',
      step: { status: 'RUNNING', attempt: 1, startedAt: requestedAt },
      phase: 'RELEASING',
      outcome: 'PENDING',
      residuals: [],
    }),
    (error: unknown) => error instanceof FaultRunCommandError
      && error.code === 'RECOVERY_STEP_TRANSITION_INVALID',
  );

  const draining = mergeFaultRunRecoveryStep(initial, {
    stage: 'DRAIN',
    step: { status: 'RUNNING', attempt: 1, startedAt: requestedAt },
    phase: 'DRAINING',
    outcome: 'PENDING',
    residuals: [],
  });
  assert.equal(parseFaultRunRecoveryProjection(draining).kind, 'SAFE_RUNTIME_V1');

  const drained = mergeFaultRunRecoveryStep(draining, {
    stage: 'DRAIN',
    step: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    phase: 'RELEASING',
    outcome: 'PENDING',
    residuals: [],
  });
  assert.equal(drained.drain.status, 'SUCCEEDED');
});

test('does not turn an unconfigured verification policy into a terminal state', () => {
  const initial = initialProjection();
  const nominallyCompleted: FaultRunRecoveryProjection = {
    ...initial,
    phase: 'COMPLETED',
    outcome: 'SUCCEEDED',
    drain: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    release: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    cleanup: { status: 'NOT_APPLICABLE', attempt: 0 },
    verification: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    residuals: [],
  };

  assert.equal(
    deriveFaultRunRecoveryCompletionState(createRun(), nominallyCompleted),
    'RECOVERING',
  );
});

test('turns an accepted manual cleanup request into a separately durable pending step', () => {
  const initial = initialProjection();
  const manualCleanupRequired: FaultRunRecoveryProjection = {
    ...initial,
    phase: 'MANUAL_CLEANUP_REQUIRED',
    outcome: 'MANUAL_CLEANUP_REQUIRED',
    drain: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    release: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: requestedAt,
      completedAt,
    },
    cleanup: {
      status: 'MANUAL_REQUIRED',
      attempt: 0,
      errorCode: 'MANUAL_CLEANUP_REQUIRED',
    },
    residuals: [{
      kind: 'MANUAL_CLEANUP_PENDING',
      responsibility: 'OPERATOR',
      nextAction: 'COMPLETE_MANUAL_CLEANUP',
    }],
    lastError: {
      stage: 'CLEANUP',
      code: 'MANUAL_CLEANUP_REQUIRED',
      retryable: false,
    },
  };

  const pendingCleanup = startFaultRunManualCleanup(
    manualCleanupRequired,
    hashFaultRunCommandIdempotencyKey('cleanup-request-001'),
    new Date('2026-09-17T10:00:20.000Z'),
  );
  assert.equal(pendingCleanup.phase, 'CLEANING');
  assert.equal(pendingCleanup.outcome, 'PENDING');
  assert.equal(pendingCleanup.cleanup.status, 'RUNNING');
  assert.equal(pendingCleanup.cleanup.requestKeyHash, hashFaultRunCommandIdempotencyKey('cleanup-request-001'));
  assert.equal(pendingCleanup.lastError, undefined);
});

test('retention preserves each run before deleting its events and keeps the original eligibility boundary', async () => {
  const calls: string[] = [];
  const eligibleRuns = [
    { fault_run_id: '123e4567-e89b-12d3-a456-426614174000', operator_audit_id: 17 },
    { fault_run_id: '223e4567-e89b-12d3-a456-426614174001', operator_audit_id: null },
  ];
  const connection = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes('information_schema.tables')) {
        return [[
          { table_name: 'evidence_contract_snapshots' },
          { table_name: 'evidence_query_manifests' },
        ], []];
      }
      if (sql.includes('SELECT fault_run_id, operator_audit_id FROM fault_runs')) {
        return [eligibleRuns, []];
      }
      return [{ affectedRows: sql.includes('DELETE FROM fault_runs') ? 2 : 1 }, []];
    },
  };
  const preservedRunIds: string[] = [];

  const deleted = await deleteExpiredFaultRunsWithConnection(
    connection as unknown as PoolConnection,
    {
      async preserveManifestBeforeRunRetention(_connection, runId) {
        preservedRunIds.push(runId);
        return runId === eligibleRuns[0]?.fault_run_id;
      },
    },
  );

  assert.equal(deleted, 2);
  assert.deepEqual(preservedRunIds, eligibleRuns.map(({ fault_run_id }) => fault_run_id));
  const eligibilityQuery = calls.find((sql) =>
    sql.includes('SELECT fault_run_id, operator_audit_id FROM fault_runs'));
  assert.ok(eligibilityQuery);
  assert.match(eligibilityQuery, /stopped_at IS NOT NULL/u);
  assert.match(eligibilityQuery, /recovery_result IS NOT NULL/u);
  assert.match(eligibilityQuery, /state IN \('RECOVERED', 'STOPPED', 'FAILED'\)/u);
  assert.match(eligibilityQuery, /INTERVAL 7 DAY/u);
  assert.ok(calls.findIndex((sql) => sql.includes('DELETE FROM fault_run_events'))
    > calls.findIndex((sql) => sql.includes('SELECT fault_run_id, operator_audit_id')));
  assert.ok(calls.findIndex((sql) => sql.includes('DELETE FROM fault_runs'))
    > calls.findIndex((sql) => sql.includes('DELETE FROM fault_run_events')));
});

test('retention aborts deletion when frozen Manifest preservation fails', async () => {
  const calls: string[] = [];
  const connection = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes('information_schema.tables')) {
        return [[
          { table_name: 'evidence_contract_snapshots' },
          { table_name: 'evidence_query_manifests' },
        ], []];
      }
      if (sql.includes('SELECT fault_run_id, operator_audit_id FROM fault_runs')) {
        return [[{ fault_run_id: '123e4567-e89b-12d3-a456-426614174000', operator_audit_id: 17 }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };

  await assert.rejects(
    deleteExpiredFaultRunsWithConnection(
      connection as unknown as PoolConnection,
      {
        async preserveManifestBeforeRunRetention() {
          throw new Error('manifest materialization failed');
        },
      },
    ),
    /manifest materialization failed/u,
  );
  assert.equal(calls.some((sql) => sql.startsWith('DELETE FROM')), false);
});

test('retention keeps legacy deletion when Evidence tables were never installed', async () => {
  const calls: string[] = [];
  const connection = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes('information_schema.tables')) return [[], []];
      if (sql.includes('SELECT fault_run_id, operator_audit_id FROM fault_runs')) {
        return [[{ fault_run_id: '123e4567-e89b-12d3-a456-426614174000', operator_audit_id: null }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  let preserveCalls = 0;

  const deleted = await deleteExpiredFaultRunsWithConnection(
    connection as unknown as PoolConnection,
    {
      async preserveManifestBeforeRunRetention() {
        preserveCalls += 1;
        return false;
      },
    },
  );

  assert.equal(deleted, 1);
  assert.equal(preserveCalls, 0);
  assert.ok(calls.some((sql) => sql.startsWith('DELETE FROM fault_runs')));
});

test('retention performs no Evidence schema lookup when no runs are eligible', async () => {
  const calls: string[] = [];
  const connection = {
    async query(sql: string) {
      calls.push(sql);
      return [[], []];
    },
  };

  const deleted = await deleteExpiredFaultRunsWithConnection(
    connection as unknown as PoolConnection,
    {
      async preserveManifestBeforeRunRetention() {
        throw new Error('no run should need preservation');
      },
    },
  );

  assert.equal(deleted, 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.includes('SELECT fault_run_id, operator_audit_id FROM fault_runs'));
});

test('retention refuses deletion when only part of the Evidence schema is installed', async () => {
  const calls: string[] = [];
  const connection = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes('SELECT fault_run_id, operator_audit_id FROM fault_runs')) {
        return [[{ fault_run_id: '123e4567-e89b-12d3-a456-426614174000', operator_audit_id: null }], []];
      }
      if (sql.includes('information_schema.tables')) {
        return [[{ table_name: 'evidence_contract_snapshots' }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };

  await assert.rejects(
    deleteExpiredFaultRunsWithConnection(
      connection as unknown as PoolConnection,
      {
        async preserveManifestBeforeRunRetention() {
          throw new Error('partial schema must fail before materialization');
        },
      },
    ),
    /EVIDENCE_RETENTION_SCHEMA_INCOMPLETE/u,
  );
  assert.equal(calls.some((sql) => sql.startsWith('DELETE FROM')), false);
});

function createFaultRunCaptureInput(): CreateFaultRunInput {
  const definition = getScenarioDefinition('BROWSE_REPORT_SQL');
  const contract = resolveScenarioContract(definition);
  const contractRevision = getScenarioContractRevision(contract);
  const evidenceCaptureSnapshot = createEvidenceCaptureSnapshot(
    contractRevision,
    contract.evidence,
    renderEvidenceQueryPlan(contract.evidence, {
      baseline: 900,
      active: definition.maxDurationSec + 60,
      recovery: 2100,
      cleanup: 600,
    }),
  );
  return {
    scenario: definition.scenario,
    targetService: definition.targetService,
    targetOperation: definition.targetOperation,
    parameters: { durationSec: 30 },
    contractRevision,
    catalogRevision: getCatalogRevision(),
    idempotencyKey: 'create-evidence-transaction-001',
    expiresAt: new Date('2026-10-09T06:00:30.000Z'),
    traceId: 'trace-evidence-transaction',
    evidenceCaptureSnapshot,
  };
}

interface FaultRunCreateTransactionState {
  sequence: number;
  runs: Record<string, unknown>[];
  events: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  commits: number;
  rollbacks: number;
  failSnapshotInsert: boolean;
  queries: string[];
}

function createFaultRunTransactionState(
  overrides: Partial<FaultRunCreateTransactionState> = {},
): FaultRunCreateTransactionState {
  return {
    sequence: 0,
    runs: [],
    events: [],
    snapshots: [],
    commits: 0,
    rollbacks: 0,
    failSnapshotInsert: false,
    queries: [],
    ...overrides,
  };
}

class FakeFaultRunCreateConnection {
  private backup: Pick<FaultRunCreateTransactionState, 'sequence' | 'runs' | 'events' | 'snapshots'> | null = null;

  constructor(private readonly state: FaultRunCreateTransactionState) {}

  async beginTransaction(): Promise<void> {
    this.backup = structuredClone({
      sequence: this.state.sequence,
      runs: this.state.runs,
      events: this.state.events,
      snapshots: this.state.snapshots,
    });
  }

  async commit(): Promise<void> {
    this.state.commits += 1;
    this.backup = null;
  }

  async rollback(): Promise<void> {
    if (this.backup) {
      Object.assign(this.state, this.backup);
      this.backup = null;
    }
    this.state.rollbacks += 1;
  }

  release(): void {}

  async query(sql: string, values: unknown[] = []): Promise<[unknown, unknown]> {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    this.state.queries.push(normalized);
    if (normalized.startsWith('SELECT * FROM fault_runs')) {
      return [
        this.state.runs.filter((row) => row.idempotency_key === values[0]),
        [],
      ];
    }
    if (normalized.startsWith('UPDATE fault_run_sequence')) {
      this.state.sequence += 1;
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('SELECT last_token FROM fault_run_sequence')) {
      return [[{ last_token: this.state.sequence }], []];
    }
    if (normalized.startsWith('INSERT INTO fault_runs')) {
      const [id, scenario, targetService, targetOperation, parametersJson,
        contractRevision, idempotencyKey, fencingToken, expiresAt, traceId] = values;
      this.state.runs.push({
        fault_run_id: id,
        scenario,
        target_service: targetService,
        target_operation: targetOperation,
        state: 'CREATING',
        parameters_json: parametersJson,
        contract_revision: contractRevision,
        idempotency_key: idempotencyKey,
        fencing_token: fencingToken,
        started_at: null,
        expires_at: expiresAt,
        stopped_at: null,
        stop_reason: null,
        recovery_result: null,
        recovery_error: null,
        operator_audit_id: null,
        trace_id: traceId,
        created_at: new Date('2026-10-09T06:00:00.000Z'),
        updated_at: new Date('2026-10-09T06:00:00.000Z'),
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO fault_run_events')) {
      const [faultRunId, eventType, payload] = values;
      this.state.events.push({ fault_run_id: faultRunId, event_type: eventType, payload });
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`UNEXPECTED_FAULT_RUN_CREATE_QUERY:${normalized}`);
  }

  async execute(sql: string, values: unknown[] = []): Promise<[unknown, unknown]> {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    this.state.queries.push(normalized);
    if (!normalized.startsWith('INSERT INTO evidence_contract_snapshots')) {
      throw new Error(`UNEXPECTED_FAULT_RUN_CREATE_EXECUTE:${normalized}`);
    }
    if (this.state.failSnapshotInsert) throw new Error('FAKE_EVIDENCE_SNAPSHOT_WRITE_FAILED');
    const [id, sourceRunId, scenario, contractRevision, contractHash, contractJson,
      rendererRevision, evaluationRevision, renderedPlanHash, renderedPlanJson] = values;
    this.state.snapshots.push({
      snapshot_id: id,
      source_fault_run_id: sourceRunId,
      scenario,
      contract_revision: contractRevision,
      contract_hash: contractHash,
      contract_json: contractJson,
      renderer_revision: rendererRevision,
      evaluation_revision: evaluationRevision,
      rendered_plan_hash: renderedPlanHash,
      rendered_plan_json: renderedPlanJson,
    });
    return [{ affectedRows: 1 }, []];
  }
}
