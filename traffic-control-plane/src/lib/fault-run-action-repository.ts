import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getPool } from './db';
import { verifyFaultRunOwnershipSchema } from './fault-run-schema';
import { serializeFaultRunEventPayload } from './fault-run-event-policy';

export type FaultRunActionType = 'PREPARE' | 'RELEASE' | 'CLEANUP';
export type FaultRunActionState =
  | 'REQUESTED'
  | 'DISPATCHING'
  | 'CONFIRMED'
  | 'DEFINITIVE_FAILURE'
  | 'OUTCOME_UNKNOWN'
  | 'CANCELLED';
export type FaultRunActionRequester = 'OPERATOR' | 'RECONCILER';

export interface FaultRunActionRecord {
  actionId: string;
  faultRunId: string;
  actionType: FaultRunActionType;
  attemptNo: number;
  actionState: FaultRunActionState;
  requestedBy: FaultRunActionRequester;
  requestIdempotencyKey: string;
  operatorAuditId: number | null;
  dispatchOwnerId: string | null;
  dispatchOwnerEpoch: number | null;
  requestedAt: string;
  dispatchStartedAt: string | null;
  completedAt: string | null;
  resultSummary: unknown;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFaultRunActionInput {
  faultRunId: string;
  actionType: FaultRunActionType;
  attemptNo?: number;
  requestedBy: FaultRunActionRequester;
  requestIdempotencyKey: string;
  operatorAuditId?: number | null;
}

export async function insertFaultRunAction(
  connection: PoolConnection,
  input: CreateFaultRunActionInput,
): Promise<string> {
  const actionId = randomUUID();
  await connection.query(
    `INSERT INTO fault_run_actions
      (action_id, fault_run_id, action_type, attempt_no, action_state,
       requested_by, request_idempotency_key, operator_audit_id)
     VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, ?)`,
    [
      actionId,
      input.faultRunId,
      input.actionType,
      input.attemptNo ?? 1,
      input.requestedBy,
      validateRequestIdempotencyKey(input.requestIdempotencyKey),
      input.operatorAuditId ?? null,
    ],
  );
  return actionId;
}

export async function createFaultRunAction(
  input: CreateFaultRunActionInput,
): Promise<{ action: FaultRunActionRecord; created: boolean }> {
  await verifyFaultRunOwnershipSchema();
  const connection = await getPool().getConnection();
  try {
    const actionId = await insertFaultRunAction(connection, input);
    const action = await loadFaultRunActionWithConnection(connection, actionId);
    if (!action) throw new Error('FAULT_RUN_ACTION_CREATE_READBACK_FAILED');
    return { action, created: true };
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;
    const existing = await loadFaultRunActionByRequestWithConnection(
      connection,
      input.faultRunId,
      input.actionType,
      input.requestIdempotencyKey,
    );
    if (!existing) throw error;
    return { action: existing, created: false };
  } finally {
    connection.release();
  }
}

export async function loadFaultRunAction(actionId: string): Promise<FaultRunActionRecord | null> {
  await verifyFaultRunOwnershipSchema();
  const [rows] = await getPool().query(
    'SELECT * FROM fault_run_actions WHERE action_id = ?',
    [actionId],
  );
  const row = asRecords(rows)[0];
  return row ? toFaultRunAction(row) : null;
}

export async function loadFaultRunActionByRequest(
  faultRunId: string,
  actionType: FaultRunActionType,
  requestIdempotencyKey: string,
): Promise<FaultRunActionRecord | null> {
  await verifyFaultRunOwnershipSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_run_actions
      WHERE fault_run_id = ? AND action_type = ? AND request_idempotency_key = ?`,
    [faultRunId, actionType, validateRequestIdempotencyKey(requestIdempotencyKey)],
  );
  const row = asRecords(rows)[0];
  return row ? toFaultRunAction(row) : null;
}

export async function listFaultRunActions(faultRunId: string): Promise<FaultRunActionRecord[]> {
  await verifyFaultRunOwnershipSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM fault_run_actions
      WHERE fault_run_id = ?
      ORDER BY requested_at, action_id`,
    [faultRunId],
  );
  return asRecords(rows).map(toFaultRunAction);
}

export async function claimFaultRunAction(input: {
  actionId: string;
  ownerId: string;
  ownerEpoch: number;
}): Promise<FaultRunActionRecord | null> {
  await verifyFaultRunOwnershipSchema();
  const connection = await getPool().getConnection();
  let transactionComplete = false;
  try {
    await connection.beginTransaction();
    const [actionRefRows] = await connection.query(
      'SELECT fault_run_id FROM fault_run_actions WHERE action_id = ?',
      [input.actionId],
    );
    const faultRunId = asRecords(actionRefRows)[0]?.fault_run_id;
    if (faultRunId === undefined) {
      await connection.commit();
      transactionComplete = true;
      return null;
    }
    const [runRows] = await connection.query(
      'SELECT state FROM fault_runs WHERE fault_run_id = ? FOR UPDATE',
      [faultRunId],
    );
    if (asRecords(runRows).length === 0) {
      await connection.commit();
      transactionComplete = true;
      return null;
    }
    const [executionRows] = await connection.query(
      `SELECT fault_run_id
         FROM fault_run_executions
        WHERE fault_run_id = ?
          AND owner_id = ?
          AND owner_epoch = ?
          AND lease_expires_at > CURRENT_TIMESTAMP(3)
          AND reconciliation_state <> 'MANUAL_INTERVENTION_REQUIRED'
        FOR UPDATE`,
      [faultRunId, input.ownerId, input.ownerEpoch],
    );
    if (asRecords(executionRows).length === 0) {
      await connection.commit();
      transactionComplete = true;
      return null;
    }
    const [actionRows] = await connection.query(
      `SELECT * FROM fault_run_actions
        WHERE action_id = ? AND fault_run_id = ?
        FOR UPDATE`,
      [input.actionId, faultRunId],
    );
    const actionRow = asRecords(actionRows)[0];
    if (!actionRow || actionRow.action_state !== 'REQUESTED'
      || actionRow.dispatch_owner_id !== null
      || actionRow.dispatch_owner_epoch !== null) {
      await connection.commit();
      transactionComplete = true;
      return null;
    }
    const [result] = await connection.query(
      `UPDATE fault_run_actions action
        JOIN fault_run_executions execution ON execution.fault_run_id = action.fault_run_id
        JOIN fault_runs run ON run.fault_run_id = action.fault_run_id
          SET action.action_state = 'DISPATCHING',
              dispatch_owner_id = ?,
              dispatch_owner_epoch = ?,
              dispatch_started_at = CURRENT_TIMESTAMP(3),
              error_code = NULL
        WHERE action.action_id = ?
          AND action.action_state = 'REQUESTED'
          AND action.dispatch_owner_id IS NULL
          AND action.dispatch_owner_epoch IS NULL
          AND execution.owner_id = ?
          AND execution.owner_epoch = ?
          AND execution.lease_expires_at > CURRENT_TIMESTAMP(3)
          AND execution.reconciliation_state <> 'MANUAL_INTERVENTION_REQUIRED'
          AND (action.action_type <> 'PREPARE'
            OR (run.state = 'CREATING' AND run.expires_at > CURRENT_TIMESTAMP(3)))`,
      [input.ownerId, input.ownerEpoch, input.actionId, input.ownerId, input.ownerEpoch],
    );
    if (affectedRows(result) !== 1) {
      await connection.rollback();
      transactionComplete = true;
      return null;
    }
    const claimed = await loadFaultRunActionWithConnection(connection, input.actionId);
    await connection.commit();
    transactionComplete = true;
    return claimed;
  } catch (error) {
    if (!transactionComplete) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function confirmFaultRunAction(input: {
  actionId: string;
  ownerId: string;
  ownerEpoch: number;
  resultSummary: unknown;
}): Promise<boolean> {
  return finishFaultRunAction({
    ...input,
    actionState: 'CONFIRMED',
    resultSummary: sanitizeFaultRunActionSummary(input.resultSummary),
    errorCode: null,
  });
}

export async function failFaultRunAction(input: {
  actionId: string;
  ownerId: string;
  ownerEpoch: number;
  errorCode: string;
}): Promise<boolean> {
  return finishFaultRunAction({
    ...input,
    actionState: 'DEFINITIVE_FAILURE',
    resultSummary: null,
    errorCode: normalizeErrorCode(input.errorCode),
  });
}

export async function markFaultRunActionUnknown(input: {
  actionId: string;
  ownerId: string;
  ownerEpoch: number;
  errorCode: string;
}): Promise<boolean> {
  return finishFaultRunAction({
    ...input,
    actionState: 'OUTCOME_UNKNOWN',
    resultSummary: null,
    errorCode: normalizeErrorCode(input.errorCode),
  });
}

export async function markOwnedFaultRunActionUnknown(input: {
  actionId: string;
  actionType: Extract<FaultRunActionType, 'RELEASE' | 'CLEANUP'>;
  ownerId: string;
  ownerEpoch: number;
  errorCode: string;
}): Promise<boolean> {
  await verifyFaultRunOwnershipSchema();
  const connection = await getPool().getConnection();
  let transactionComplete = false;
  try {
    await connection.beginTransaction();
    const [actionRefRows] = await connection.query(
      'SELECT fault_run_id FROM fault_run_actions WHERE action_id = ?',
      [input.actionId],
    );
    const faultRunId = asRecords(actionRefRows)[0]?.fault_run_id;
    if (faultRunId === undefined) {
      await connection.commit();
      transactionComplete = true;
      return false;
    }
    const [runRows] = await connection.query(
      'SELECT fault_run_id FROM fault_runs WHERE fault_run_id = ? FOR UPDATE',
      [faultRunId],
    );
    if (asRecords(runRows).length === 0) {
      await connection.commit();
      transactionComplete = true;
      return false;
    }
    const [executionRows] = await connection.query(
      `SELECT fault_run_id
         FROM fault_run_executions
        WHERE fault_run_id = ?
          AND owner_id = ?
          AND owner_epoch = ?
          AND lease_expires_at > CURRENT_TIMESTAMP(3)
          AND reconciliation_state <> 'MANUAL_INTERVENTION_REQUIRED'
        FOR UPDATE`,
      [faultRunId, input.ownerId, input.ownerEpoch],
    );
    if (asRecords(executionRows).length === 0) {
      await connection.commit();
      transactionComplete = true;
      return false;
    }
    const [actionRows] = await connection.query(
      `SELECT action_id
         FROM fault_run_actions
        WHERE action_id = ?
          AND fault_run_id = ?
          AND action_type = ?
          AND action_state = 'DISPATCHING'
          AND dispatch_owner_id = ?
          AND dispatch_owner_epoch = ?
        FOR UPDATE`,
      [input.actionId, faultRunId, input.actionType, input.ownerId, input.ownerEpoch],
    );
    if (asRecords(actionRows).length === 0) {
      await connection.commit();
      transactionComplete = true;
      return false;
    }
    const [result] = await connection.query(
      `UPDATE fault_run_actions
          SET action_state = 'OUTCOME_UNKNOWN',
              completed_at = CURRENT_TIMESTAMP(3),
              result_summary_json = NULL,
              error_code = ?
        WHERE action_id = ?
          AND fault_run_id = ?
          AND action_type = ?
          AND action_state = 'DISPATCHING'
          AND dispatch_owner_id = ?
          AND dispatch_owner_epoch = ?`,
      [
        normalizeErrorCode(input.errorCode),
        input.actionId,
        faultRunId,
        input.actionType,
        input.ownerId,
        input.ownerEpoch,
      ],
    );
    if (affectedRows(result) !== 1) {
      await connection.rollback();
      transactionComplete = true;
      return false;
    }
    await markManualIntervention(connection, input.actionId, input.errorCode);
    await connection.commit();
    transactionComplete = true;
    return true;
  } catch (error) {
    if (!transactionComplete) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function markStaleFaultRunActionUnknown(input: {
  actionId: string;
  dispatchOwnerId: string;
  dispatchOwnerEpoch: number;
  errorCode: string;
}): Promise<boolean> {
  await verifyFaultRunOwnershipSchema();
  const connection = await getPool().getConnection();
  let transactionComplete = false;
  try {
    await connection.beginTransaction();
    const [actionRefRows] = await connection.query(
      'SELECT fault_run_id FROM fault_run_actions WHERE action_id = ?',
      [input.actionId],
    );
    const faultRunId = asRecords(actionRefRows)[0]?.fault_run_id;
    if (faultRunId === undefined) {
      await connection.commit();
      transactionComplete = true;
      return false;
    }
    const [runRows] = await connection.query(
      'SELECT fault_run_id FROM fault_runs WHERE fault_run_id = ? FOR UPDATE',
      [faultRunId],
    );
    if (asRecords(runRows).length === 0) {
      await connection.commit();
      transactionComplete = true;
      return false;
    }
    const [executionRows] = await connection.query(
      `SELECT fault_run_id
         FROM fault_run_executions
        WHERE fault_run_id = ?
          AND (NOT (owner_id <=> ?)
            OR owner_epoch > ?
            OR lease_expires_at <= CURRENT_TIMESTAMP(3))
        FOR UPDATE`,
      [faultRunId, input.dispatchOwnerId, input.dispatchOwnerEpoch],
    );
    if (asRecords(executionRows).length === 0) {
      await connection.commit();
      transactionComplete = true;
      return false;
    }
    const [actionRows] = await connection.query(
      `SELECT action_id
         FROM fault_run_actions
        WHERE action_id = ?
          AND fault_run_id = ?
          AND action_state = 'DISPATCHING'
          AND dispatch_owner_id = ?
          AND dispatch_owner_epoch = ?
        FOR UPDATE`,
      [input.actionId, faultRunId, input.dispatchOwnerId, input.dispatchOwnerEpoch],
    );
    if (asRecords(actionRows).length === 0) {
      await connection.commit();
      transactionComplete = true;
      return false;
    }
    const [result] = await connection.query(
      `UPDATE fault_run_actions
          SET action_state = 'OUTCOME_UNKNOWN',
              completed_at = CURRENT_TIMESTAMP(3),
              error_code = ?
        WHERE action_id = ?
          AND fault_run_id = ?
          AND action_state = 'DISPATCHING'
          AND dispatch_owner_id = ?
          AND dispatch_owner_epoch = ?`,
      [
        normalizeErrorCode(input.errorCode),
        input.actionId,
        faultRunId,
        input.dispatchOwnerId,
        input.dispatchOwnerEpoch,
      ],
    );
    if (affectedRows(result) !== 1) {
      await connection.rollback();
      transactionComplete = true;
      return false;
    }
    await markManualIntervention(connection, input.actionId, 'OWNER_LEASE_EXPIRED');
    await connection.commit();
    transactionComplete = true;
    return true;
  } catch (error) {
    if (!transactionComplete) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function markPrepareOutcomeUnknown(input: {
  actionId: string;
  ownerId: string;
  ownerEpoch: number;
  errorCode: string;
}): Promise<boolean> {
  await verifyFaultRunOwnershipSchema();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE fault_run_actions action
       JOIN fault_run_executions execution ON execution.fault_run_id = action.fault_run_id
       SET action.action_state = 'OUTCOME_UNKNOWN',
           action.completed_at = CURRENT_TIMESTAMP(3),
           action.error_code = ?
       WHERE action.action_id = ? AND action.action_type = 'PREPARE'
         AND action.action_state = 'DISPATCHING'
         AND action.dispatch_owner_id = ? AND action.dispatch_owner_epoch = ?
         AND execution.owner_id = ? AND execution.owner_epoch = ?
         AND execution.lease_expires_at > CURRENT_TIMESTAMP(3)`,
      [normalizeErrorCode(input.errorCode), input.actionId,
        input.ownerId, input.ownerEpoch, input.ownerId, input.ownerEpoch],
    );
    if (affectedRows(result) !== 1) {
      await connection.rollback();
      return false;
    }
    await markManualIntervention(connection, input.actionId, input.errorCode);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function markManualIntervention(connection: PoolConnection, actionId: string, reason: string): Promise<void> {
  await connection.query(
    `UPDATE fault_run_executions execution
     JOIN fault_run_actions action ON action.fault_run_id = execution.fault_run_id
     SET execution.reconciliation_state = 'MANUAL_INTERVENTION_REQUIRED',
         execution.last_action = 'ACTION_OUTCOME_UNKNOWN',
         execution.last_action_at = CURRENT_TIMESTAMP(3),
         execution.last_error_code = ?
     WHERE action.action_id = ?`,
    [normalizeErrorCode(reason), actionId],
  );
  await connection.query(
    `INSERT INTO fault_run_events (fault_run_id, event_type, payload)
     SELECT fault_run_id, 'ACTION_OUTCOME_UNKNOWN', ?
     FROM fault_run_actions WHERE action_id = ?`,
    [serializeFaultRunEventPayload('ACTION_OUTCOME_UNKNOWN', {
      reason: 'OUTCOME_UNKNOWN',
    }), actionId],
  );
}

export function toFaultRunAction(row: Record<string, unknown>): FaultRunActionRecord {
  return {
    actionId: String(row.action_id),
    faultRunId: String(row.fault_run_id),
    actionType: String(row.action_type) as FaultRunActionType,
    attemptNo: Number(row.attempt_no),
    actionState: String(row.action_state) as FaultRunActionState,
    requestedBy: String(row.requested_by) as FaultRunActionRequester,
    requestIdempotencyKey: String(row.request_idempotency_key),
    operatorAuditId: nullableNumber(row.operator_audit_id),
    dispatchOwnerId: nullableString(row.dispatch_owner_id),
    dispatchOwnerEpoch: nullableNumber(row.dispatch_owner_epoch),
    requestedAt: toIso(row.requested_at),
    dispatchStartedAt: nullableIso(row.dispatch_started_at),
    completedAt: nullableIso(row.completed_at),
    resultSummary: parseJson(row.result_summary_json),
    errorCode: nullableString(row.error_code),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function sanitizeFaultRunActionSummary(value: unknown): Record<string, boolean | number | string> {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_FAULT_RUN_ACTION_SUMMARY');
  }
  const allowedKeys = new Set([
    'accepted',
    'cleaned',
    'deletedBytes',
    'deletedNotifications',
    'errorCode',
    'hashRemoved',
    'healthy',
    'markerRemoved',
    'mode',
    'operation',
    'released',
    'restartRequested',
    'restarted',
    'serviceRestarted',
    'sizeBytes',
    'status',
    'target',
  ]);
  const summary: Record<string, boolean | number | string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowedKeys.has(key)) throw new Error('INVALID_FAULT_RUN_ACTION_SUMMARY');
    if (typeof raw === 'boolean') {
      summary[key] = raw;
      continue;
    }
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
      summary[key] = raw;
      continue;
    }
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= 128
        && /^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/.test(raw)) {
      summary[key] = raw;
      continue;
    }
    throw new Error('INVALID_FAULT_RUN_ACTION_SUMMARY');
  }
  return summary;
}

async function finishFaultRunAction(input: {
  actionId: string;
  ownerId: string;
  ownerEpoch: number;
  actionState: Extract<FaultRunActionState, 'CONFIRMED' | 'DEFINITIVE_FAILURE' | 'OUTCOME_UNKNOWN'>;
  resultSummary: unknown;
  errorCode: string | null;
}): Promise<boolean> {
  await verifyFaultRunOwnershipSchema();
  const [result] = await getPool().query(
    `UPDATE fault_run_actions action
      JOIN fault_run_executions execution ON execution.fault_run_id = action.fault_run_id
        SET action.action_state = ?,
            completed_at = CURRENT_TIMESTAMP(3),
            result_summary_json = ?,
            error_code = ?
      WHERE action.action_id = ?
        AND action.action_state = 'DISPATCHING'
        AND action.dispatch_owner_id = ?
        AND action.dispatch_owner_epoch = ?
        AND execution.owner_id = ?
        AND execution.owner_epoch = ?
        AND execution.lease_expires_at > CURRENT_TIMESTAMP(3)`,
    [
      input.actionState,
      input.resultSummary === null ? null : JSON.stringify(input.resultSummary),
      input.errorCode,
      input.actionId,
      input.ownerId,
      input.ownerEpoch,
      input.ownerId,
      input.ownerEpoch,
    ],
  );
  return affectedRows(result) === 1;
}

async function loadFaultRunActionWithConnection(
  connection: PoolConnection,
  actionId: string,
): Promise<FaultRunActionRecord | null> {
  const [rows] = await connection.query(
    'SELECT * FROM fault_run_actions WHERE action_id = ?',
    [actionId],
  );
  const row = asRecords(rows)[0];
  return row ? toFaultRunAction(row) : null;
}

async function loadFaultRunActionByRequestWithConnection(
  connection: PoolConnection,
  faultRunId: string,
  actionType: FaultRunActionType,
  requestIdempotencyKey: string,
): Promise<FaultRunActionRecord | null> {
  const [rows] = await connection.query(
    `SELECT * FROM fault_run_actions
      WHERE fault_run_id = ? AND action_type = ? AND request_idempotency_key = ?`,
    [faultRunId, actionType, validateRequestIdempotencyKey(requestIdempotencyKey)],
  );
  const row = asRecords(rows)[0];
  return row ? toFaultRunAction(row) : null;
}

function validateRequestIdempotencyKey(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw new Error('INVALID_ACTION_IDEMPOTENCY_KEY');
  }
  return value;
}

function normalizeErrorCode(value: string): string {
  return /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(value) ? value : 'FAULT_RUN_ACTION_FAILED';
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

function affectedRows(result: unknown): number {
  return Number(asRecord(result).affectedRows ?? 0);
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
