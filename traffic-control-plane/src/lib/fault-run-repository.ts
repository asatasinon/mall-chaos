import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getPool } from './db';
import {
  normalizeFaultRunRecoveryEventPayload,
  type FaultRunRecoveryEventType,
} from './fault-run-event-contract';
import { ensureFaultRunSchema } from './fault-run-schema';
import { serializeFaultRunEventPayload } from './fault-run-event-policy';
import {
  CATALOG_LARGE_VALUE_MIN_MEMBER_SIZE_BYTES,
  getScenarioDefinition,
  type FaultRunScenario,
  type FaultRunState,
} from './fault-run-catalog';
import {
  FAULT_RUN_STOP_REASONS,
  createInitialFaultRunRecoveryProjection,
  parseFaultRunRecoveryProjection,
  serializeFaultRunRecoveryProjection,
  type FaultRunCleanupRecoveryStep,
  type FaultRunDrainRecoveryStep,
  type FaultRunRecoveryError,
  type FaultRunRecoveryErrorStage,
  type FaultRunRecoveryProjection,
  type FaultRunRecoveryProjectionRead,
  type FaultRunRecoveryResidual,
  type FaultRunRecoveryStep,
  type FaultRunStopReason,
} from './fault-run-recovery';
import {
  resolveFaultRunRecoveryPolicy,
  type FaultRunResolvedRecoveryPolicy,
} from './fault-run-recovery-policy';
import { insertOperatorAudit } from './operator-audit';
import {
  createFaultRunExecution,
  type FaultRunExecutionMode,
} from './fault-run-execution-repository';
import { insertFaultRunAction } from './fault-run-action-repository';

export interface FaultRunRecord {
  faultRunId: string;
  scenario: FaultRunScenario;
  targetService: string;
  targetOperation: string;
  state: FaultRunState;
  parameters: Record<string, number | string>;
  idempotencyKey: string;
  fencingToken: number;
  startedAt: string | null;
  expiresAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  recoveryResult: unknown;
  recoveryError: string | null;
  operatorAuditId: number | null;
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FaultRunEventRecord {
  id: number;
  faultRunId: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export interface FaultRunTargetSummary {
  accepted?: boolean;
  layout?: 'HASH';
  hashKey?: string;
  memberCount?: number;
  memberSizeBytes?: number;
  logicalBytes?: number;
  observedBytes?: number;
  probeSku?: string;
  memberSkus?: string[];
  expiresAt?: string;
  keyTtlSec?: number;
}

export interface FaultRunTargetConfirmedPayload {
  targetService: string;
  targetSummary?: FaultRunTargetSummary;
}

export interface FaultRunAuditRecord {
  id: number;
  operatorId: number | null;
  action: string;
  target: string | null;
  parameterHash: string | null;
  result: 'SUCCESS' | 'FAILURE';
  correlationId: string | null;
  createdAt: string;
}

export interface CreateFaultRunInput {
  scenario: FaultRunScenario;
  targetService: string;
  targetOperation: string;
  parameters: Record<string, number | string>;
  idempotencyKey: string;
  expiresAt: Date;
  traceId: string;
  executionMode?: FaultRunExecutionMode;
}

export const FAULT_RUN_COMMAND_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export interface FaultRunCommandAuditInput {
  operatorId: number | null;
  correlationId?: string;
}

export interface RequestFaultRunStopInput {
  faultRunId: string;
  reason: FaultRunStopReason;
  requestKey?: string;
  drainTimeoutMs: number;
  recoveryTimeoutMs: number;
  audit?: FaultRunCommandAuditInput;
  now?: Date;
}

export interface RequestFaultRunManualCleanupInput {
  faultRunId: string;
  requestKey: string;
  audit: FaultRunCommandAuditInput;
  now?: Date;
}

export interface FaultRunRecoveryStepMutation {
  stage: FaultRunRecoveryErrorStage;
  step: FaultRunRecoveryStep | FaultRunDrainRecoveryStep | FaultRunCleanupRecoveryStep;
  phase: FaultRunRecoveryProjection['phase'];
  outcome: FaultRunRecoveryProjection['outcome'];
  residuals: readonly FaultRunRecoveryResidual[];
  lastError?: FaultRunRecoveryError;
}

export interface RecordFaultRunRecoveryStepInput {
  faultRunId: string;
  expectedAttempt: number;
  mutation: FaultRunRecoveryStepMutation;
  eventType: FaultRunRecoveryEventType;
  eventPayload?: unknown;
}

export interface CompleteFaultRunRecoveryInput {
  faultRunId: string;
  expectedAttempt: number;
  projection: FaultRunRecoveryProjection;
  eventType: Extract<FaultRunRecoveryEventType,
    'RECOVERY_PARTIAL' | 'RECOVERY_BLOCKED' | 'RECOVERY_COMPLETED'>;
  eventPayload?: unknown;
}

export interface CompleteFaultRunManualCleanupInput {
  faultRunId: string;
  expectedAttempt: number;
  projection: FaultRunRecoveryProjection;
  eventType: Extract<FaultRunRecoveryEventType,
    'MANUAL_CLEANUP_COMPLETED' | 'MANUAL_CLEANUP_FAILED'>;
  eventPayload?: unknown;
}

export type FaultRunCommandDisposition = 'ACCEPTED' | 'REPLAYED' | 'TERMINAL';

export interface FaultRunCommandResult {
  disposition: FaultRunCommandDisposition;
  run: FaultRunRecord;
  recovery: FaultRunRecoveryProjectionRead;
}

export class FaultRunCommandError extends Error {
  constructor(public readonly code:
    | 'INVALID_COMMAND_IDEMPOTENCY_KEY'
    | 'MANUAL_STOP_AUDIT_REQUIRED'
    | 'INVALID_RECOVERY_TIMEOUTS'
    | 'STOP_REQUEST_CONFLICT'
    | 'RECOVERY_STATE_INVALID'
    | 'RECOVERY_ATTEMPT_CONFLICT'
    | 'RECOVERY_STEP_TRANSITION_INVALID'
    | 'RECOVERY_EVENT_INVALID'
    | 'CLEANUP_NOT_ALLOWED'
    | 'CLEANUP_REQUEST_CONFLICT'
    | 'CLEANUP_STATE_INVALID',
  ) {
    super(code);
    this.name = 'FaultRunCommandError';
  }
}

export class ActiveFaultRunError extends Error {
  constructor(public readonly activeRun: FaultRunRecord) {
    super(`ACTIVE_FAULT_RUN:${activeRun.faultRunId}`);
    this.name = 'ActiveFaultRunError';
  }
}

export class IdempotencyKeyReuseError extends Error {
  constructor() {
    super('IDEMPOTENCY_KEY_REUSED');
    this.name = 'IdempotencyKeyReuseError';
  }
}

export async function createFaultRun(
  input: CreateFaultRunInput,
): Promise<{ run: FaultRunRecord; created: boolean }> {
  await ensureFaultRunSchema();
  const pool = getPool();
  const connection = await pool.getConnection();
  const faultRunId = randomUUID();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query(
      'SELECT * FROM fault_runs WHERE idempotency_key = ? FOR UPDATE',
      [input.idempotencyKey],
    );
    const existing = asRecords(existingRows)[0];
    if (existing) {
      await connection.rollback();
      const existingRun = toFaultRun(existing);
        if (existingRun.scenario !== input.scenario
          || stableJson(existingRun.parameters) !== stableJson(input.parameters)) {
        throw new IdempotencyKeyReuseError();
      }
      return { run: existingRun, created: false };
    }

    await connection.query(
      'UPDATE fault_run_sequence SET last_token = last_token + 1 WHERE id = 1',
    );
    const [tokenRows] = await connection.query(
      'SELECT last_token FROM fault_run_sequence WHERE id = 1 FOR UPDATE',
    );
    const fencingToken = Number(asRecords(tokenRows)[0]?.last_token);
    await connection.query(
      `INSERT INTO fault_runs
        (fault_run_id, scenario, target_service, target_operation, state, parameters_json,
         idempotency_key, fencing_token, expires_at, trace_id)
       VALUES (?, ?, ?, ?, 'CREATING', ?, ?, ?, ?, ?)`,
      [
        faultRunId,
        input.scenario,
        input.targetService,
        input.targetOperation,
        JSON.stringify(input.parameters),
        input.idempotencyKey,
        fencingToken,
        input.expiresAt,
        input.traceId,
      ],
    );
    await insertEvent(connection, faultRunId, 'CREATED', {
      scenario: input.scenario,
      targetService: input.targetService,
      targetOperation: input.targetOperation,
      expiresAt: input.expiresAt.toISOString(),
      fencingToken,
    });
    if (input.executionMode !== undefined) {
      await createFaultRunExecution(connection, faultRunId, input.executionMode);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (isDuplicateEntry(error)) {
      const existingRun = await loadFaultRunByIdempotencyKey(input.idempotencyKey);
      if (existingRun) {
        if (existingRun.scenario !== input.scenario
          || stableJson(existingRun.parameters) !== stableJson(input.parameters)) {
          throw new IdempotencyKeyReuseError();
        }
        return { run: existingRun, created: false };
      }
      const activeRun = await loadActiveFaultRun();
      if (activeRun) throw new ActiveFaultRunError(activeRun);
    }
    throw error;
  } finally {
    connection.release();
  }

  const run = await loadFaultRun(faultRunId);
  if (!run) throw new Error('FAULT_RUN_CREATE_READBACK_FAILED');
  return { run, created: true };
}

export async function loadFaultRun(faultRunId: string): Promise<FaultRunRecord | null> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query('SELECT * FROM fault_runs WHERE fault_run_id = ?', [faultRunId]);
  const row = asRecords(rows)[0];
  return row ? toFaultRun(row) : null;
}

export async function loadFaultRunByIdempotencyKey(key: string): Promise<FaultRunRecord | null> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query('SELECT * FROM fault_runs WHERE idempotency_key = ?', [key]);
  const row = asRecords(rows)[0];
  return row ? toFaultRun(row) : null;
}

export async function loadActiveFaultRun(): Promise<FaultRunRecord | null> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_runs
     WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')
     ORDER BY created_at, fault_run_id
     LIMIT 1`,
  );
  const row = asRecords(rows)[0];
  return row ? toFaultRun(row) : null;
}

export async function loadRunnableFaultRun(faultRunId?: string): Promise<FaultRunRecord | null> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    faultRunId
      ? `SELECT * FROM fault_runs
         WHERE fault_run_id = ? AND state = 'ACTIVE'
         LIMIT 1`
      : `SELECT * FROM fault_runs
         WHERE state = 'ACTIVE'
         ORDER BY expires_at, created_at
         LIMIT 1`,
    faultRunId ? [faultRunId] : [],
  );
  const row = asRecords(rows)[0];
  return row ? toFaultRun(row) : null;
}

export async function listFaultRuns(filters: {
  state?: FaultRunState;
  scenario?: FaultRunScenario;
  limit?: number;
} = {}): Promise<FaultRunRecord[]> {
  await ensureFaultRunSchema();
  const conditions = [
    'created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)',
  ];
  const values: unknown[] = [];
  if (filters.state) {
    conditions.push('state = ?');
    values.push(filters.state);
  }
  if (filters.scenario) {
    conditions.push('scenario = ?');
    values.push(filters.scenario);
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const [rows] = await getPool().query(
    `SELECT * FROM fault_runs WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC, fault_run_id DESC LIMIT ${limit}`,
    values,
  );
  return asRecords(rows).map(toFaultRun);
}

export async function listExpiredActiveFaultRuns(now = new Date()): Promise<FaultRunRecord[]> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_runs
     WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING') AND expires_at <= ?
     ORDER BY expires_at, created_at`,
    [now],
  );
  return asRecords(rows).map(toFaultRun);
}

export async function listActiveFaultRuns(): Promise<FaultRunRecord[]> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_runs
     WHERE state IN ('CREATING', 'ACTIVE', 'RECOVERING')
     ORDER BY expires_at, created_at`,
  );
  return asRecords(rows).map(toFaultRun);
}

export async function listFaultRunReconciliationCandidates(): Promise<FaultRunRecord[]> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT run.*
       FROM fault_runs run
       JOIN fault_run_executions execution
         ON execution.fault_run_id = run.fault_run_id
      WHERE run.state IN ('CREATING', 'ACTIVE', 'RECOVERING')
        AND (
          execution.owner_id IS NULL
          OR execution.lease_expires_at <= CURRENT_TIMESTAMP(3)
        )
      ORDER BY run.expires_at, run.created_at, run.fault_run_id`,
  );
  return asRecords(rows).map(toFaultRun);
}

export async function listRunnableFaultRuns(): Promise<FaultRunRecord[]> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_runs
     WHERE state = 'ACTIVE'
     ORDER BY expires_at, created_at`,
  );
  return asRecords(rows).map(toFaultRun);
}

export async function listShutdownCandidateFaultRuns(): Promise<FaultRunRecord[]> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_runs
     WHERE state IN ('CREATING', 'ACTIVE')
     ORDER BY created_at, fault_run_id`,
  );
  return asRecords(rows).map(toFaultRun);
}

export async function listRecoveringFaultRuns(): Promise<FaultRunRecord[]> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_runs
     WHERE state = 'RECOVERING'
     ORDER BY updated_at, fault_run_id`,
  );
  return asRecords(rows).map(toFaultRun);
}

export async function listExpiredRunnableFaultRuns(now = new Date()): Promise<FaultRunRecord[]> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_runs
     WHERE state = 'ACTIVE' AND expires_at <= ?
     ORDER BY expires_at, created_at`,
    [now],
  );
  return asRecords(rows).map(toFaultRun);
}

export function isRunnableFaultRun(run: Pick<FaultRunRecord, 'state'>): boolean {
  return run.state === 'ACTIVE';
}

export function hashFaultRunCommandIdempotencyKey(key: string): string {
  if (!FAULT_RUN_COMMAND_IDEMPOTENCY_KEY.test(key)) {
    throw new FaultRunCommandError('INVALID_COMMAND_IDEMPOTENCY_KEY');
  }
  return createHash('sha256').update(key).digest('hex');
}

export function planFaultRunStop(
  run: FaultRunRecord,
  input: {
    reason: FaultRunStopReason;
    requestKeyHash?: string;
    requestedAt: Date;
    drainTimeoutMs: number;
    recoveryTimeoutMs: number;
  },
): {
  disposition: FaultRunCommandDisposition;
  projection: FaultRunRecoveryProjection | null;
} {
  assertRecoveryTimeouts(input.drainTimeoutMs, input.recoveryTimeoutMs);
  if (!isFaultRunStopReason(input.reason)) {
    throw new FaultRunCommandError('RECOVERY_STATE_INVALID');
  }
  if (input.requestKeyHash !== undefined && !/^[a-f0-9]{64}$/.test(input.requestKeyHash)) {
    throw new FaultRunCommandError('INVALID_COMMAND_IDEMPOTENCY_KEY');
  }

  const recovery = parseFaultRunRecoveryProjection(run.recoveryResult);
  if (isTerminalFaultRunState(run.state)) {
    return { disposition: 'TERMINAL', projection: recovery.projection };
  }

  const reason = run.expiresAt <= input.requestedAt.toISOString() ? 'EXPIRED' : input.reason;
  if (run.state === 'CREATING' || run.state === 'ACTIVE') {
    return {
      disposition: 'ACCEPTED',
      projection: createInitialFaultRunRecoveryProjection({
        reason,
        requestedAt: input.requestedAt,
        drainDeadlineAt: new Date(input.requestedAt.getTime() + input.drainTimeoutMs),
        recoveryDeadlineAt: new Date(input.requestedAt.getTime() + input.recoveryTimeoutMs),
        ...(input.requestKeyHash === undefined ? {} : { requestKeyHash: input.requestKeyHash }),
      }),
    };
  }

  if (run.state !== 'RECOVERING' || recovery.kind !== 'SAFE_RUNTIME_V1') {
    throw new FaultRunCommandError('STOP_REQUEST_CONFLICT');
  }

  if (input.requestKeyHash !== undefined
    && recovery.projection.stop.requestKeyHash === input.requestKeyHash) {
    return { disposition: 'REPLAYED', projection: recovery.projection };
  }
  if (input.requestKeyHash === undefined && recovery.projection.stop.reason === 'EXPIRED') {
    return { disposition: 'REPLAYED', projection: recovery.projection };
  }
  if (!isRetryableRecoveryProjection(recovery.projection)) {
    throw new FaultRunCommandError('STOP_REQUEST_CONFLICT');
  }

  return {
    disposition: 'ACCEPTED',
    projection: createInitialFaultRunRecoveryProjection({
      reason: recovery.projection.stop.reason,
      requestedAt: input.requestedAt,
      drainDeadlineAt: new Date(input.requestedAt.getTime() + input.drainTimeoutMs),
      recoveryDeadlineAt: new Date(input.requestedAt.getTime() + input.recoveryTimeoutMs),
      ...(input.requestKeyHash === undefined ? {} : { requestKeyHash: input.requestKeyHash }),
      attempt: recovery.projection.stop.attempt + 1,
    }),
  };
}

export async function requestFaultRunStop(
  input: RequestFaultRunStopInput,
): Promise<FaultRunCommandResult | null> {
  if (input.reason === 'MANUAL' && !input.requestKey) {
    throw new FaultRunCommandError('INVALID_COMMAND_IDEMPOTENCY_KEY');
  }
  if (input.reason === 'MANUAL' && !input.audit) {
    throw new FaultRunCommandError('MANUAL_STOP_AUDIT_REQUIRED');
  }
  const requestKeyHash = input.requestKey === undefined
    ? undefined
    : hashFaultRunCommandIdempotencyKey(input.requestKey);
  assertRecoveryTimeouts(input.drainTimeoutMs, input.recoveryTimeoutMs);

  await ensureFaultRunSchema();
  const connection = await getPool().getConnection();
  let result: FaultRunCommandResult | null = null;
  let transactionComplete = false;
  try {
    await connection.beginTransaction();
    const run = await loadLockedFaultRun(connection, input.faultRunId);
    if (!run) {
      await connection.commit();
      transactionComplete = true;
      return null;
    }

    const plan = planFaultRunStop(run, {
      reason: input.reason,
      ...(requestKeyHash === undefined ? {} : { requestKeyHash }),
      requestedAt: input.now ?? new Date(),
      drainTimeoutMs: input.drainTimeoutMs,
      recoveryTimeoutMs: input.recoveryTimeoutMs,
    });
    if (plan.disposition !== 'ACCEPTED' || !plan.projection) {
      await connection.commit();
      transactionComplete = true;
      return {
        disposition: plan.disposition,
        run,
        recovery: parseFaultRunRecoveryProjection(run.recoveryResult),
      };
    }

    const auditId = input.audit
      ? await insertOperatorAudit(connection, {
        operatorId: input.audit.operatorId,
        action: 'FAULT_RUN_STOP',
        target: run.scenario,
        parameters: {
          faultRunId: run.faultRunId,
          command: 'STOP',
          requestKeyHash: plan.projection.stop.requestKeyHash ?? null,
        },
        result: 'SUCCESS',
        correlationId: input.audit.correlationId,
      })
      : null;
    const serializedProjection = serializeFaultRunRecoveryProjection(plan.projection);
    await connection.query(
      `UPDATE fault_runs
       SET state = 'RECOVERING', stop_reason = ?, recovery_result = ?, recovery_error = NULL
       WHERE fault_run_id = ?`,
      [plan.projection.stop.reason, serializedProjection, run.faultRunId],
    );
    await insertRecoveryEvent(connection, run.faultRunId, 'STOP_REQUESTED', {
      reason: plan.projection.stop.reason,
      attempt: plan.projection.stop.attempt,
      drainDeadlineAt: plan.projection.deadlines.drainAt,
      recoveryDeadlineAt: plan.projection.deadlines.recoveryAt,
      ...(auditId === null ? {} : { operatorAuditId: auditId }),
    });
    await connection.commit();
    transactionComplete = true;
    result = {
      disposition: 'ACCEPTED',
      run: {
        ...run,
        state: 'RECOVERING',
        stopReason: plan.projection.stop.reason,
        recoveryResult: JSON.parse(serializedProjection),
        recoveryError: null,
      },
      recovery: { kind: 'SAFE_RUNTIME_V1', projection: plan.projection },
    };
  } catch (error) {
    if (!transactionComplete) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return result;
}

export async function requestFaultRunManualCleanup(
  input: RequestFaultRunManualCleanupInput,
): Promise<FaultRunCommandResult | null> {
  const requestKeyHash = hashFaultRunCommandIdempotencyKey(input.requestKey);
  await ensureFaultRunSchema();
  const connection = await getPool().getConnection();
  let result: FaultRunCommandResult | null = null;
  let transactionComplete = false;
  try {
    await connection.beginTransaction();
    const run = await loadLockedFaultRun(connection, input.faultRunId);
    if (!run) {
      await connection.commit();
      transactionComplete = true;
      return null;
    }
    const policy = resolveFaultRunRecoveryPolicy(getScenarioDefinition(run.scenario));
    const recovery = parseFaultRunRecoveryProjection(run.recoveryResult);
    if (policy.cleanup === 'OPTIONAL_PER_RUN') {
      if (!isTerminalFaultRunState(run.state)) {
        throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
      }
      const existingAction = await insertManualCleanupActionIfOwned(
        connection,
        run.faultRunId,
        requestKeyHash,
        null,
      );
      if (!existingAction.owned) {
        throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
      }
      if (!existingAction.created) {
        await connection.commit();
        transactionComplete = true;
        return {
          disposition: 'REPLAYED',
          run,
          recovery,
        };
      }
      const auditId = await insertOperatorAudit(connection, {
        operatorId: input.audit.operatorId,
        action: 'FAULT_RUN_CLEANUP',
        target: run.scenario,
        parameters: {
          faultRunId: run.faultRunId,
          command: 'MANUAL_CLEANUP',
          requestKeyHash,
        },
        result: 'SUCCESS',
        correlationId: input.audit.correlationId,
      });
      await connection.query(
        `UPDATE fault_run_actions
            SET operator_audit_id = ?
          WHERE action_id = ?`,
        [auditId, existingAction.actionId],
      );
      await insertRecoveryEvent(connection, run.faultRunId, 'MANUAL_CLEANUP_REQUESTED', {
        operatorAuditId: auditId,
        actionId: existingAction.actionId,
        cleanupAttempt: 1,
      });
      await connection.commit();
      transactionComplete = true;
      return {
        disposition: 'ACCEPTED',
        run,
        recovery,
      };
    }
    if (isTerminalFaultRunState(run.state)) {
      await connection.commit();
      transactionComplete = true;
      return {
        disposition: 'TERMINAL',
        run,
        recovery: parseFaultRunRecoveryProjection(run.recoveryResult),
      };
    }
    if (run.state !== 'RECOVERING') {
      throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
    }

    if (recovery.kind !== 'SAFE_RUNTIME_V1') {
      throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
    }
    if (policy.cleanup !== 'OPERATOR_CONFIRMED') {
      throw new FaultRunCommandError('CLEANUP_NOT_ALLOWED');
    }
    if (recovery.projection.phase === 'CLEANING') {
      if (recovery.projection.cleanup.requestKeyHash === requestKeyHash) {
        await connection.commit();
        transactionComplete = true;
        return {
          disposition: 'REPLAYED',
          run,
          recovery,
        };
      }
      throw new FaultRunCommandError('CLEANUP_REQUEST_CONFLICT');
    }
    if (recovery.projection.phase !== 'MANUAL_CLEANUP_REQUIRED'
      || recovery.projection.cleanup.status !== 'MANUAL_REQUIRED') {
      throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
    }

    const requestedAt = input.now ?? new Date();
    const nextProjection = startFaultRunManualCleanup(
      recovery.projection,
      requestKeyHash,
      requestedAt,
    );
    const parsed = parseFaultRunRecoveryProjection(nextProjection);
    if (parsed.kind !== 'SAFE_RUNTIME_V1') {
      throw new FaultRunCommandError('RECOVERY_STEP_TRANSITION_INVALID');
    }
    const auditId = await insertOperatorAudit(connection, {
      operatorId: input.audit.operatorId,
      action: 'FAULT_RUN_CLEANUP',
      target: run.scenario,
      parameters: {
        faultRunId: run.faultRunId,
        command: 'MANUAL_CLEANUP',
        requestKeyHash,
      },
      result: 'SUCCESS',
      correlationId: input.audit.correlationId,
    });
    const action = await insertManualCleanupActionIfOwned(
      connection,
      run.faultRunId,
      requestKeyHash,
      auditId,
    );
    const serializedProjection = serializeFaultRunRecoveryProjection(parsed.projection);
    await connection.query(
      `UPDATE fault_runs
       SET recovery_result = ?, recovery_error = NULL
       WHERE fault_run_id = ? AND state = 'RECOVERING'`,
      [serializedProjection, run.faultRunId],
    );
    await insertRecoveryEvent(connection, run.faultRunId, 'MANUAL_CLEANUP_REQUESTED', {
      attempt: parsed.projection.stop.attempt,
      cleanupAttempt: parsed.projection.cleanup.attempt,
      operatorAuditId: auditId,
      ...(action.actionId === null ? {} : { actionId: action.actionId }),
    });
    await connection.commit();
    transactionComplete = true;
    result = {
      disposition: 'ACCEPTED',
      run: {
        ...run,
        recoveryResult: JSON.parse(serializedProjection),
        recoveryError: null,
      },
      recovery: { kind: 'SAFE_RUNTIME_V1', projection: parsed.projection },
    };
  } catch (error) {
    if (!transactionComplete) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  async function insertManualCleanupActionIfOwned(
    connection: PoolConnection,
    faultRunId: string,
    requestKeyHash: string,
    operatorAuditId: number | null,
  ): Promise<{ actionId: string | null; created: boolean; owned: boolean }> {
    try {
      const [rows] = await connection.query(
        `SELECT fault_run_id
           FROM fault_run_executions
          WHERE fault_run_id = ?
          FOR UPDATE`,
        [faultRunId],
      );
      if (asRecords(rows).length === 0) {
        return { actionId: null, created: false, owned: false };
      }
      const [existingRows] = await connection.query(
        `SELECT action_id
           FROM fault_run_actions
          WHERE fault_run_id = ? AND action_type = 'CLEANUP'
            AND request_idempotency_key = ?
          FOR UPDATE`,
        [faultRunId, requestKeyHash],
      );
      const existing = asRecords(existingRows)[0];
      if (existing) return { actionId: String(existing.action_id), created: false, owned: true };
      const actionId = await insertFaultRunAction(connection, {
        faultRunId,
        actionType: 'CLEANUP',
        requestedBy: 'OPERATOR',
        requestIdempotencyKey: requestKeyHash,
        operatorAuditId,
      });
      return { actionId, created: true, owned: true };
    } catch (error) {
      if (isMissingTableError(error)) return { actionId: null, created: false, owned: false };
      throw error;
    }
  }
  return result;
}

export function mergeFaultRunRecoveryStep(
  current: FaultRunRecoveryProjection,
  mutation: FaultRunRecoveryStepMutation,
): FaultRunRecoveryProjection {
  const currentStep = recoveryStepForStage(current, mutation.stage);
  if (!isValidRecoveryStepTransition(currentStep, mutation.step)) {
    throw new FaultRunCommandError('RECOVERY_STEP_TRANSITION_INVALID');
  }
  if (!areRecoveryStepPrerequisitesSettled(current, mutation.stage)) {
    throw new FaultRunCommandError('RECOVERY_STEP_TRANSITION_INVALID');
  }
  if (mutation.step.status !== 'NOT_APPLICABLE'
    && mutation.step.status !== 'MANUAL_REQUIRED'
    && mutation.step.attempt !== current.stop.attempt) {
    throw new FaultRunCommandError('RECOVERY_ATTEMPT_CONFLICT');
  }
  if (mutation.stage === 'CLEANUP'
    && current.cleanup.requestKeyHash !== undefined) {
    throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
  }

  const next: FaultRunRecoveryProjection = {
    schemaVersion: current.schemaVersion,
    phase: mutation.phase,
    outcome: mutation.outcome,
    stop: current.stop,
    deadlines: current.deadlines,
    drain: mutation.stage === 'DRAIN'
      ? mutation.step as FaultRunDrainRecoveryStep
      : current.drain,
    release: mutation.stage === 'RELEASE'
      ? mutation.step
      : current.release,
    cleanup: mutation.stage === 'CLEANUP'
      ? mutation.step as FaultRunCleanupRecoveryStep
      : current.cleanup,
    verification: mutation.stage === 'VERIFY'
      ? mutation.step
      : current.verification,
    residuals: mutation.residuals,
    ...(mutation.lastError === undefined ? {} : { lastError: mutation.lastError }),
  };
  const parsed = parseFaultRunRecoveryProjection(next);
  if (parsed.kind !== 'SAFE_RUNTIME_V1') {
    throw new FaultRunCommandError('RECOVERY_STEP_TRANSITION_INVALID');
  }
  return parsed.projection;
}

export function startFaultRunManualCleanup(
  current: FaultRunRecoveryProjection,
  requestKeyHash: string,
  requestedAt: Date,
): FaultRunRecoveryProjection {
  if (current.phase !== 'MANUAL_CLEANUP_REQUIRED'
    || current.cleanup.status !== 'MANUAL_REQUIRED'
    || !/^[a-f0-9]{64}$/.test(requestKeyHash)) {
    throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
  }
  const next: FaultRunRecoveryProjection = {
    schemaVersion: current.schemaVersion,
    phase: 'CLEANING',
    outcome: 'PENDING',
    stop: current.stop,
    deadlines: current.deadlines,
    drain: current.drain,
    release: current.release,
    cleanup: {
      status: 'RUNNING',
      attempt: current.stop.attempt,
      startedAt: requestedAt.toISOString(),
      requestKeyHash,
    },
    verification: current.verification,
    residuals: current.residuals,
  };
  const parsed = parseFaultRunRecoveryProjection(next);
  if (parsed.kind !== 'SAFE_RUNTIME_V1') {
    throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
  }
  return parsed.projection;
}

export async function recordFaultRunRecoveryStep(
  input: RecordFaultRunRecoveryStepInput,
): Promise<FaultRunRecord | null> {
  if (!isRecoveryEventForStage(input.eventType, input.mutation.stage)) {
    throw new FaultRunCommandError('RECOVERY_EVENT_INVALID');
  }
  await ensureFaultRunSchema();
  const connection = await getPool().getConnection();
  let updated = false;
  let transactionComplete = false;
  try {
    await connection.beginTransaction();
    const run = await loadLockedFaultRun(connection, input.faultRunId);
    if (!run) {
      await connection.commit();
      transactionComplete = true;
      return null;
    }
    if (run.state !== 'RECOVERING') {
      throw new FaultRunCommandError('RECOVERY_STATE_INVALID');
    }
    const recovery = parseFaultRunRecoveryProjection(run.recoveryResult);
    if (recovery.kind !== 'SAFE_RUNTIME_V1') {
      throw new FaultRunCommandError('RECOVERY_STATE_INVALID');
    }
    if (recovery.projection.stop.attempt !== input.expectedAttempt) {
      throw new FaultRunCommandError('RECOVERY_ATTEMPT_CONFLICT');
    }
    const projection = mergeFaultRunRecoveryStep(recovery.projection, input.mutation);
    const serializedProjection = serializeFaultRunRecoveryProjection(projection);
    await connection.query(
      `UPDATE fault_runs
       SET recovery_result = ?, recovery_error = ?
       WHERE fault_run_id = ? AND state = 'RECOVERING'`,
      [serializedProjection, projection.lastError?.code ?? null, run.faultRunId],
    );
    await insertRecoveryEvent(
      connection,
      run.faultRunId,
      input.eventType,
      {
        ...asRecord(input.eventPayload),
        attempt: projection.stop.attempt,
      },
    );
    await connection.commit();
    transactionComplete = true;
    updated = true;
  } catch (error) {
    if (!transactionComplete) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (!updated) return null;
  return loadFaultRun(input.faultRunId);
}

export function deriveFaultRunRecoveryCompletionState(
  run: Pick<FaultRunRecord, 'scenario'>,
  projection: FaultRunRecoveryProjection,
): Extract<FaultRunState, 'RECOVERING' | 'STOPPED' | 'RECOVERED'> {
  const policy = resolveFaultRunRecoveryPolicy(getScenarioDefinition(run.scenario));
  if (projection.phase !== 'COMPLETED'
    || projection.outcome !== 'SUCCEEDED'
    || !areRequiredRecoveryStepsComplete(projection, policy)) {
    return 'RECOVERING';
  }
  return projection.stop.reason === 'MANUAL' ? 'STOPPED' : 'RECOVERED';
}

export async function completeFaultRunRecovery(
  input: CompleteFaultRunRecoveryInput,
): Promise<FaultRunRecord | null> {
  return completeFaultRunRecoveryProjection(input, false);
}

export async function completeFaultRunManualCleanup(
  input: CompleteFaultRunManualCleanupInput,
): Promise<FaultRunRecord | null> {
  return completeFaultRunRecoveryProjection(input, true);
}

export const recordRecoveryStep = recordFaultRunRecoveryStep;
export const completeRecovery = completeFaultRunRecovery;
export const completeManualCleanup = completeFaultRunManualCleanup;

export async function transitionFaultRun(
  faultRunId: string,
  expectedStates: readonly FaultRunState[],
  nextState: FaultRunState,
  details: { eventType: string; payload?: unknown; stopReason?: string; recoveryResult?: unknown; recoveryError?: string },
): Promise<FaultRunRecord | null> {
  await ensureFaultRunSchema();
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const terminal = ['RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].includes(nextState);
    const fields = ['state = ?'];
    const values: unknown[] = [nextState];
    if (nextState === 'ACTIVE') fields.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3))');
    if (terminal) fields.push('stopped_at = COALESCE(stopped_at, CURRENT_TIMESTAMP(3))');
    if (details.stopReason !== undefined) {
      fields.push('stop_reason = ?');
      values.push(details.stopReason);
    }
    if (details.recoveryResult !== undefined) {
      fields.push('recovery_result = ?');
      values.push(JSON.stringify(details.recoveryResult));
    }
    if (details.recoveryError !== undefined) {
      fields.push('recovery_error = ?');
      values.push(details.recoveryError.slice(0, 1024));
    }
    values.push(faultRunId, ...expectedStates);
    const [result] = await connection.query(
      `UPDATE fault_runs SET ${fields.join(', ')}
       WHERE fault_run_id = ? AND state IN (${expectedStates.map(() => '?').join(', ')})`,
      values,
    );
    if (Number((result as { affectedRows?: number }).affectedRows ?? 0) === 0) {
      await connection.rollback();
      return loadFaultRun(faultRunId);
    }
    await insertEvent(connection, faultRunId, details.eventType, details.payload ?? {});
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return loadFaultRun(faultRunId);
}

export async function appendFaultRunEvent(
  faultRunId: string,
  eventType: string,
  payload: unknown = {},
): Promise<void> {
  await ensureFaultRunSchema();
  await insertEvent(getPool(), faultRunId, eventType, payload);
}

export async function attachOperatorAudit(faultRunId: string, auditId: number): Promise<void> {
  await ensureFaultRunSchema();
  await getPool().query(
    'UPDATE fault_runs SET operator_audit_id = ? WHERE fault_run_id = ?',
    [auditId, faultRunId],
  );
}

export async function loadFaultRunEvents(faultRunId: string): Promise<FaultRunEventRecord[]> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT id, fault_run_id, event_type, payload, created_at
     FROM fault_run_events WHERE fault_run_id = ? ORDER BY created_at, id`,
    [faultRunId],
  );
  return asRecords(rows).map((row) => ({
    id: Number(row.id),
    faultRunId: String(row.fault_run_id),
    eventType: String(row.event_type),
    payload: parseJson(row.payload),
    createdAt: toIso(row.created_at),
  }));
}

export async function loadFaultRunTargetSummary(
  faultRunId: string,
): Promise<FaultRunTargetSummary | null> {
  const events = await loadFaultRunEvents(faultRunId);
  for (const event of [...events].reverse()) {
    if (event.eventType !== 'TARGET_CONFIRMED') continue;
    const summary = extractFaultRunTargetSummary(faultRunId, event.payload);
    if (summary) return summary;
  }
  return null;
}

export function extractFaultRunTargetSummary(
  faultRunId: string,
  payload: unknown,
): FaultRunTargetSummary | null {
  const event = asRecord(payload);
  const summary = asRecord(event.targetSummary);
  if (summary.layout !== 'HASH'
      || summary.hashKey !== `catalog:product-detail:operation:${faultRunId}`
      || !isSafeInteger(summary.memberCount, 1, 47)
      || !isSafeInteger(summary.memberSizeBytes,
        CATALOG_LARGE_VALUE_MIN_MEMBER_SIZE_BYTES, 128 * 1024 * 1024)
      || !isSafeInteger(summary.logicalBytes, 1, 512 * 1024 * 1024)
      || !isSafeInteger(summary.keyTtlSec, 1, 3600)
      || typeof summary.probeSku !== 'string'
      || !isSku(summary.probeSku)
      || !Array.isArray(summary.memberSkus)) {
    return null;
  }
  const rawMemberSkus = summary.memberSkus as unknown[];
  const memberSkus = rawMemberSkus.filter((value): value is string => isSku(value));
  if (memberSkus.length !== rawMemberSkus.length
      || memberSkus.length !== summary.memberCount
      || new Set(memberSkus).size !== memberSkus.length
      || memberSkus.includes(summary.probeSku)) {
    return null;
  }
  if (summary.logicalBytes !== summary.memberCount * summary.memberSizeBytes) return null;

  const result: FaultRunTargetSummary = {
    layout: 'HASH',
    hashKey: summary.hashKey,
    memberCount: summary.memberCount,
    memberSizeBytes: summary.memberSizeBytes,
    logicalBytes: summary.logicalBytes,
    keyTtlSec: summary.keyTtlSec,
    probeSku: summary.probeSku,
    memberSkus,
  };
  if (isSafeInteger(summary.observedBytes, 1, Number.MAX_SAFE_INTEGER)) {
    result.observedBytes = summary.observedBytes;
  }
  if (typeof summary.expiresAt === 'string' && !Number.isNaN(Date.parse(summary.expiresAt))) {
    result.expiresAt = summary.expiresAt;
  }
  return result;
}

export async function loadFaultRunAudit(faultRunId: string): Promise<FaultRunAuditRecord | null> {
  await ensureFaultRunSchema();
  const [rows] = await getPool().query(
    `SELECT audit.id, audit.operator_id, audit.action, audit.target, audit.parameter_hash,
            audit.result, audit.correlation_id, audit.created_at
     FROM fault_runs run
     LEFT JOIN operator_audit_logs audit ON audit.id = run.operator_audit_id
     WHERE run.fault_run_id = ?`,
    [faultRunId],
  );
  const row = asRecords(rows)[0];
  if (!row || row.id === null || row.id === undefined) return null;
  return toFaultRunAudit(row);
}

export async function loadFaultRunAudits(faultRunId: string): Promise<FaultRunAuditRecord[]> {
  await ensureFaultRunSchema();
  const [eventRows] = await getPool().query(
    `SELECT event_type, payload
     FROM fault_run_events
     WHERE fault_run_id = ?
     ORDER BY created_at, id`,
    [faultRunId],
  );
  const auditIds = asRecords(eventRows)
    .map((event) => extractRecoveryEventAuditId(
      String(event.event_type),
      parseJson(event.payload),
    ))
    .filter((id): id is number => id !== null);
  const uniqueAuditIds = [...new Set(auditIds)];
  if (uniqueAuditIds.length === 0) return [];
  const placeholders = uniqueAuditIds.map(() => '?').join(', ');
  const [auditRows] = await getPool().query(
    `SELECT id, operator_id, action, target, parameter_hash, result, correlation_id, created_at
     FROM operator_audit_logs
     WHERE id IN (${placeholders})`,
    uniqueAuditIds,
  );
  const auditsById = new Map(asRecords(auditRows).map((row) => {
    const audit = toFaultRunAudit(row);
    return [audit.id, audit] as const;
  }));
  return auditIds.flatMap((id) => {
    const audit = auditsById.get(id);
    return audit ? [audit] : [];
  });
}

export async function deleteExpiredFaultRuns(): Promise<number> {
  await ensureFaultRunSchema();
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [eligibleRows] = await connection.query(`SELECT fault_run_id, operator_audit_id FROM fault_runs
      WHERE stopped_at IS NOT NULL
        AND recovery_result IS NOT NULL
        AND state IN ('RECOVERED', 'STOPPED', 'FAILED')
        AND stopped_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
      ORDER BY stopped_at, fault_run_id LIMIT 100`);
    const eligible = asRecords(eligibleRows);
    if (eligible.length === 0) {
      await connection.commit();
      return 0;
    }
    const runIds = eligible.map((row) => String(row.fault_run_id));
    const auditIds = eligible
      .map((row) => row.operator_audit_id)
      .filter((value): value is number => typeof value === 'number')
      .map(Number);
    const placeholders = runIds.map(() => '?').join(', ');
    await connection.query(`DELETE FROM fault_run_events WHERE fault_run_id IN (${placeholders})`, runIds);
    if (auditIds.length > 0) {
      const auditPlaceholders = auditIds.map(() => '?').join(', ');
      await connection.query(`DELETE FROM operator_audit_logs WHERE id IN (${auditPlaceholders})`, auditIds);
    }
    const [result] = await connection.query(
      `DELETE FROM fault_runs WHERE fault_run_id IN (${placeholders})`,
      runIds,
    );
    await connection.commit();
    return Number((result as { affectedRows?: number }).affectedRows ?? 0);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

type FaultRunTransactionConnection = {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
};

async function completeFaultRunRecoveryProjection(
  input: CompleteFaultRunRecoveryInput | CompleteFaultRunManualCleanupInput,
  manualCleanup: boolean,
): Promise<FaultRunRecord | null> {
  const candidate = parseFaultRunRecoveryProjection(input.projection);
  if (candidate.kind !== 'SAFE_RUNTIME_V1'
    || (!manualCleanup && candidate.projection.outcome === 'PENDING')) {
    throw new FaultRunCommandError('RECOVERY_STEP_TRANSITION_INVALID');
  }

  await ensureFaultRunSchema();
  const connection = await getPool().getConnection();
  let updated = false;
  let transactionComplete = false;
  try {
    await connection.beginTransaction();
    const run = await loadLockedFaultRun(connection, input.faultRunId);
    if (!run) {
      await connection.commit();
      transactionComplete = true;
      return null;
    }
    if (run.state !== 'RECOVERING') {
      throw new FaultRunCommandError('RECOVERY_STATE_INVALID');
    }
    const current = parseFaultRunRecoveryProjection(run.recoveryResult);
    if (current.kind !== 'SAFE_RUNTIME_V1') {
      throw new FaultRunCommandError('RECOVERY_STATE_INVALID');
    }
    if (current.projection.stop.attempt !== input.expectedAttempt
      || candidate.projection.stop.attempt !== input.expectedAttempt
      || !hasSameRecoveryCommand(current.projection, candidate.projection)) {
      throw new FaultRunCommandError('RECOVERY_ATTEMPT_CONFLICT');
    }

    if (manualCleanup) {
      assertManualCleanupCompletion(current.projection, candidate.projection, run);
      if ((input.eventType === 'MANUAL_CLEANUP_COMPLETED'
        && candidate.projection.cleanup.status !== 'SUCCEEDED')
        || (input.eventType === 'MANUAL_CLEANUP_FAILED'
          && !['FAILED', 'TIMED_OUT'].includes(candidate.projection.cleanup.status))) {
        throw new FaultRunCommandError('RECOVERY_EVENT_INVALID');
      }
    } else if (!haveSameRecoveryStepFacts(current.projection, candidate.projection)) {
      throw new FaultRunCommandError('RECOVERY_STEP_TRANSITION_INVALID');
    }

    const nextState = deriveFaultRunRecoveryCompletionState(run, candidate.projection);
    if (!manualCleanup
      && ((nextState === 'RECOVERING' && input.eventType === 'RECOVERY_COMPLETED')
        || (nextState !== 'RECOVERING' && input.eventType !== 'RECOVERY_COMPLETED'))) {
      throw new FaultRunCommandError('RECOVERY_EVENT_INVALID');
    }
    const serializedProjection = serializeFaultRunRecoveryProjection(candidate.projection);
    const fields = [
      'state = ?',
      'recovery_result = ?',
      'recovery_error = ?',
    ];
    const values: unknown[] = [
      nextState,
      serializedProjection,
      candidate.projection.lastError?.code ?? null,
    ];
    if (nextState !== 'RECOVERING') {
      fields.push('stopped_at = COALESCE(stopped_at, CURRENT_TIMESTAMP(3))');
    }
    values.push(run.faultRunId);
    await connection.query(
      `UPDATE fault_runs SET ${fields.join(', ')}
       WHERE fault_run_id = ? AND state = 'RECOVERING'`,
      values,
    );
    await insertRecoveryEvent(connection, run.faultRunId, input.eventType, {
      ...asRecord(input.eventPayload),
      attempt: candidate.projection.stop.attempt,
      outcome: candidate.projection.outcome,
    });
    await connection.commit();
    transactionComplete = true;
    updated = true;
  } catch (error) {
    if (!transactionComplete) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (!updated) return null;
  return loadFaultRun(input.faultRunId);
}

async function loadLockedFaultRun(
  connection: Pick<FaultRunTransactionConnection, 'query'>,
  faultRunId: string,
): Promise<FaultRunRecord | null> {
  const [rows] = await connection.query(
    'SELECT * FROM fault_runs WHERE fault_run_id = ? FOR UPDATE',
    [faultRunId],
  );
  const row = asRecords(rows)[0];
  return row ? toFaultRun(row) : null;
}

async function insertRecoveryEvent(
  connection: Pick<FaultRunTransactionConnection, 'query'>,
  faultRunId: string,
  eventType: FaultRunRecoveryEventType,
  payload: unknown,
): Promise<void> {
  await insertEvent(
    connection,
    faultRunId,
    eventType,
    normalizeFaultRunRecoveryEventPayload(eventType, payload),
  );
}

function assertRecoveryTimeouts(drainTimeoutMs: number, recoveryTimeoutMs: number): void {
  if (!Number.isSafeInteger(drainTimeoutMs)
    || !Number.isSafeInteger(recoveryTimeoutMs)
    || drainTimeoutMs < 1
    || recoveryTimeoutMs < drainTimeoutMs) {
    throw new FaultRunCommandError('INVALID_RECOVERY_TIMEOUTS');
  }
}

function isFaultRunStopReason(value: string): value is FaultRunStopReason {
  return (FAULT_RUN_STOP_REASONS as readonly string[]).includes(value);
}

function isTerminalFaultRunState(state: FaultRunState): boolean {
  return state === 'RECOVERED'
    || state === 'STOPPED'
    || state === 'FAILED'
    || state === 'SERVICE_UNAVAILABLE';
}

function isRetryableRecoveryProjection(projection: FaultRunRecoveryProjection): boolean {
  return projection.phase === 'PARTIAL_RECOVERY'
    && projection.stop.attempt < 99
    && projection.lastError?.retryable === true;
}

function recoveryStepForStage(
  projection: FaultRunRecoveryProjection,
  stage: FaultRunRecoveryErrorStage,
): FaultRunRecoveryStep {
  switch (stage) {
    case 'DRAIN':
      return projection.drain;
    case 'RELEASE':
      return projection.release;
    case 'CLEANUP':
      return projection.cleanup;
    case 'VERIFY':
      return projection.verification;
  }
}

function isValidRecoveryStepTransition(
  current: FaultRunRecoveryStep,
  next: FaultRunRecoveryStep,
): boolean {
  if (stableJson(current) === stableJson(next)) return false;
  if (current.status === 'NOT_STARTED') {
    return next.status === 'RUNNING'
      || next.status === 'NOT_APPLICABLE'
      || next.status === 'MANUAL_REQUIRED';
  }
  if (current.status === 'RUNNING') {
    return next.status === 'SUCCEEDED'
      || next.status === 'TIMED_OUT'
      || next.status === 'FAILED'
      || next.status === 'SKIPPED'
      || next.status === 'NOT_CONFIGURED';
  }
  return false;
}

function areRecoveryStepPrerequisitesSettled(
  projection: FaultRunRecoveryProjection,
  stage: FaultRunRecoveryErrorStage,
): boolean {
  switch (stage) {
    case 'DRAIN':
      return true;
    case 'RELEASE':
      return isRecoveryStepSettled(projection.drain);
    case 'CLEANUP':
      return isRecoveryStepSettled(projection.drain)
        && isRecoveryStepSettled(projection.release);
    case 'VERIFY':
      return isRecoveryStepSettled(projection.drain)
        && isRecoveryStepSettled(projection.release)
        && isRecoveryStepSettled(projection.cleanup);
  }
}

function isRecoveryStepSettled(step: FaultRunRecoveryStep): boolean {
  return step.status !== 'NOT_STARTED'
    && step.status !== 'RUNNING'
    && step.status !== 'MANUAL_REQUIRED';
}

function isRecoveryEventForStage(
  eventType: FaultRunRecoveryEventType,
  stage: FaultRunRecoveryErrorStage,
): boolean {
  switch (stage) {
    case 'DRAIN':
      return eventType === 'DRAIN_STARTED'
        || eventType === 'DRAIN_COMPLETED'
        || eventType === 'DRAIN_TIMED_OUT'
        || eventType === 'DRAIN_FAILED';
    case 'RELEASE':
      return eventType === 'RELEASE_STARTED'
        || eventType === 'RELEASE_COMPLETED'
        || eventType === 'RELEASE_FAILED'
        || eventType === 'RELEASE_SKIPPED'
        || eventType === 'NON_RELEASING_RECORDED';
    case 'CLEANUP':
      return eventType === 'MANUAL_CLEANUP_REQUIRED'
        || eventType === 'CLEANUP_SKIPPED'
        || eventType === 'MANUAL_CLEANUP_COMPLETED'
        || eventType === 'MANUAL_CLEANUP_FAILED';
    case 'VERIFY':
      return eventType === 'VERIFY_STARTED'
        || eventType === 'VERIFY_COMPLETED'
        || eventType === 'VERIFY_UNAVAILABLE'
        || eventType === 'VERIFY_FAILED';
  }
}

function haveSameRecoveryStepFacts(
  left: FaultRunRecoveryProjection,
  right: FaultRunRecoveryProjection,
): boolean {
  return stableJson(left.drain) === stableJson(right.drain)
    && stableJson(left.release) === stableJson(right.release)
    && stableJson(left.cleanup) === stableJson(right.cleanup)
    && stableJson(left.verification) === stableJson(right.verification);
}

function hasSameRecoveryCommand(
  left: FaultRunRecoveryProjection,
  right: FaultRunRecoveryProjection,
): boolean {
  return left.stop.reason === right.stop.reason
    && left.stop.requestedAt === right.stop.requestedAt
    && left.stop.requestKeyHash === right.stop.requestKeyHash
    && left.deadlines.drainAt === right.deadlines.drainAt
    && left.deadlines.recoveryAt === right.deadlines.recoveryAt;
}

function assertManualCleanupCompletion(
  current: FaultRunRecoveryProjection,
  candidate: FaultRunRecoveryProjection,
  run: FaultRunRecord,
): void {
  const policy = resolveFaultRunRecoveryPolicy(getScenarioDefinition(run.scenario));
  if (policy.cleanup !== 'OPERATOR_CONFIRMED'
    || current.phase !== 'CLEANING'
    || current.cleanup.status !== 'RUNNING'
    || current.cleanup.requestKeyHash === undefined
    || candidate.cleanup.requestKeyHash !== undefined
    || !isValidRecoveryStepTransition(current.cleanup, candidate.cleanup)
    || stableJson(current.verification) !== stableJson(candidate.verification)
    || stableJson(current.drain) !== stableJson(candidate.drain)
    || stableJson(current.release) !== stableJson(candidate.release)) {
    throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
  }
}

function areRequiredRecoveryStepsComplete(
  projection: FaultRunRecoveryProjection,
  policy: FaultRunResolvedRecoveryPolicy,
): boolean {
  const drainComplete = policy.workerDrain.requirement === 'REQUIRED'
    ? projection.drain.status === 'SUCCEEDED'
    : projection.drain.status === 'NOT_APPLICABLE';
  const releaseComplete = policy.targetRelease === 'REQUIRED'
    ? projection.release.status === 'SUCCEEDED'
    : projection.release.status === 'NOT_APPLICABLE' || projection.release.status === 'SKIPPED';
  const cleanupComplete = policy.cleanup === 'OPERATOR_CONFIRMED'
    ? projection.cleanup.status === 'SUCCEEDED'
    : projection.cleanup.status === 'NOT_APPLICABLE' || projection.cleanup.status === 'SKIPPED';
  const verificationComplete = policy.verification === 'REQUIRED'
    ? projection.verification.status === 'SUCCEEDED'
    : policy.verification === 'BEST_EFFORT'
      ? isRecoveryStepSettled(projection.verification)
      : false;
  return drainComplete && releaseComplete && cleanupComplete && verificationComplete;
}

function extractRecoveryEventAuditId(eventType: string, payload: unknown): number | null {
  const expectedAction = eventType === 'STOP_REQUESTED'
    ? 'FAULT_RUN_STOP'
    : eventType === 'MANUAL_CLEANUP_REQUESTED'
      ? 'FAULT_RUN_CLEANUP'
      : null;
  if (!expectedAction) return null;
  const value = asRecord(payload);
  if (value.schemaVersion !== 1
    || value.source !== 'safe-runtime'
    || value.auditAction !== expectedAction
    || value.auditResult !== 'SUCCESS'
    || !isSafeInteger(value.operatorAuditId, 1, Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return value.operatorAuditId;
}

function toFaultRunAudit(row: Record<string, unknown>): FaultRunAuditRecord {
  return {
    id: Number(row.id),
    operatorId: row.operator_id === null || row.operator_id === undefined ? null : Number(row.operator_id),
    action: String(row.action),
    target: row.target === null || row.target === undefined ? null : String(row.target),
    parameterHash: row.parameter_hash === null || row.parameter_hash === undefined ? null : String(row.parameter_hash),
    result: String(row.result) as 'SUCCESS' | 'FAILURE',
    correlationId: row.correlation_id === null || row.correlation_id === undefined ? null : String(row.correlation_id),
    createdAt: toIso(row.created_at),
  };
}

async function insertEvent(
  connection: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  faultRunId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await connection.query(
    `INSERT INTO fault_run_events (fault_run_id, event_type, payload)
     VALUES (?, ?, ?)`,
    [faultRunId, eventType, serializeFaultRunEventPayload(eventType, payload)],
  );
}

function toFaultRun(row: Record<string, unknown>): FaultRunRecord {
  return {
    faultRunId: String(row.fault_run_id),
    scenario: String(row.scenario) as FaultRunScenario,
    targetService: String(row.target_service),
    targetOperation: String(row.target_operation),
    state: String(row.state) as FaultRunState,
    parameters: parseJson(row.parameters_json) as Record<string, number | string>,
    idempotencyKey: String(row.idempotency_key),
    fencingToken: Number(row.fencing_token),
    startedAt: row.started_at ? toIso(row.started_at) : null,
    expiresAt: toIso(row.expires_at),
    stoppedAt: row.stopped_at ? toIso(row.stopped_at) : null,
    stopReason: row.stop_reason ? String(row.stop_reason) : null,
    recoveryResult: row.recovery_result === null || row.recovery_result === undefined ? null : parseJson(row.recovery_result),
    recoveryError: row.recovery_error ? String(row.recovery_error) : null,
    operatorAuditId: row.operator_audit_id === null || row.operator_audit_id === undefined ? null : Number(row.operator_audit_id),
    traceId: row.trace_id ? String(row.trace_id) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isSku(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && (error as { code?: string }).code === 'ER_NO_SUCH_TABLE';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
