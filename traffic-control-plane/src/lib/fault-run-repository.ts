import { randomUUID } from 'node:crypto';
import { getPool } from './db';
import { ensureFaultRunSchema } from './fault-run-schema';
import type { FaultRunScenario, FaultRunState } from './fault-run-catalog';

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

async function insertEvent(
  connection: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  faultRunId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await connection.query(
    `INSERT INTO fault_run_events (fault_run_id, event_type, payload)
     VALUES (?, ?, ?)`,
    [faultRunId, eventType, JSON.stringify(payload ?? {})],
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
