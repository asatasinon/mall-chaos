import type { PoolConnection } from 'mysql2/promise';
import { getPool } from './db';
import { verifyFaultRunOwnershipSchema } from './fault-run-schema';

export type FaultRunExecutionMode = 'OBSERVE' | 'SHADOW' | 'TAKEOVER';

export type FaultRunReconciliationState =
  | 'IDLE'
  | 'OWNED'
  | 'TAKEOVER_PENDING'
  | 'TAKEN_OVER'
  | 'RECOVERY_PENDING'
  | 'MANUAL_INTERVENTION_REQUIRED';

export type FaultRunDrainState =
  | 'IDLE'
  | 'OWNED'
  | 'DRAINING'
  | 'DRAINED'
  | 'DRAIN_TIMEOUT'
  | 'LEASE_LOST'
  | 'NOT_APPLICABLE';

export interface FaultRunExecutionRecord {
  faultRunId: string;
  executionMode: FaultRunExecutionMode;
  ownerId: string | null;
  ownerEpoch: number;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  leaseLostAt: string | null;
  reconciledAt: string | null;
  reconciliationState: FaultRunReconciliationState;
  drainState: FaultRunDrainState;
  drainDeadlineAt: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimFaultRunExecutionInput {
  faultRunId: string;
  executionMode: FaultRunExecutionMode;
  ownerId: string;
  leaseTtlMs: number;
  reconciliationState: Extract<FaultRunReconciliationState, 'OWNED' | 'TAKEN_OVER'>;
  lastAction: 'OWNER_LEASE_ACQUIRED' | 'OWNER_TAKEOVER_COMPLETED';
}

export interface UpdateOwnedFaultRunExecutionInput {
  faultRunId: string;
  ownerId: string;
  ownerEpoch: number;
  reconciliationState?: FaultRunReconciliationState;
  drainState?: FaultRunDrainState;
  drainDeadlineAt?: Date | null;
  lastAction?: string | null;
  lastErrorCode?: string | null;
}

export async function createFaultRunExecution(
  connection: PoolConnection,
  faultRunId: string,
  executionMode: FaultRunExecutionMode,
): Promise<void> {
  await connection.query(
    `INSERT INTO fault_run_executions (fault_run_id, execution_mode)
     VALUES (?, ?)`,
    [faultRunId, executionMode],
  );
}

export async function loadFaultRunExecution(
  faultRunId: string,
): Promise<FaultRunExecutionRecord | null> {
  await verifyFaultRunOwnershipSchema();
  const [rows] = await getPool().query(
    `SELECT fault_run_id, execution_mode, owner_id, owner_epoch,
            lease_acquired_at, lease_expires_at, last_heartbeat_at, lease_lost_at,
            reconciled_at, reconciliation_state, drain_state, drain_deadline_at,
            last_action, last_action_at, last_error_code, created_at, updated_at
       FROM fault_run_executions
      WHERE fault_run_id = ?`,
    [faultRunId],
  );
  const row = asRecords(rows)[0];
  return row ? toExecutionRecord(row) : null;
}

export async function claimFaultRunExecution(
  input: ClaimFaultRunExecutionInput,
): Promise<FaultRunExecutionRecord | null> {
  assertLeaseTtl(input.leaseTtlMs);
  await verifyFaultRunOwnershipSchema();
  const connection = await getPool().getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE fault_run_executions execution
       JOIN fault_runs run ON run.fault_run_id = execution.fault_run_id
       SET execution.owner_id = ?,
           execution.owner_epoch = execution.owner_epoch + 1,
           execution.lease_acquired_at = CURRENT_TIMESTAMP(3),
           execution.lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
           execution.last_heartbeat_at = CURRENT_TIMESTAMP(3),
           execution.lease_lost_at = CASE
             WHEN execution.owner_id IS NULL THEN execution.lease_lost_at
             ELSE CURRENT_TIMESTAMP(3)
           END,
           execution.reconciled_at = CURRENT_TIMESTAMP(3),
           execution.reconciliation_state = ?,
           execution.drain_state = 'OWNED',
           execution.last_action = ?,
           execution.last_action_at = CURRENT_TIMESTAMP(3),
           execution.last_error_code = NULL
       WHERE execution.fault_run_id = ?
         AND execution.execution_mode = ?
         AND (execution.owner_id IS NULL
              OR execution.lease_expires_at <= CURRENT_TIMESTAMP(3))
         AND execution.reconciliation_state <> 'MANUAL_INTERVENTION_REQUIRED'
         AND run.state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
      [
        input.ownerId,
        input.leaseTtlMs * 1000,
        input.reconciliationState,
        input.lastAction,
        input.faultRunId,
        input.executionMode,
      ],
    );
    if (affectedRows(result) !== 1) return null;

    const [rows] = await connection.query(
      `SELECT fault_run_id, execution_mode, owner_id, owner_epoch,
              lease_acquired_at, lease_expires_at, last_heartbeat_at, lease_lost_at,
              reconciled_at, reconciliation_state, drain_state, drain_deadline_at,
              last_action, last_action_at, last_error_code, created_at, updated_at
         FROM fault_run_executions
        WHERE fault_run_id = ? AND owner_id = ?`,
      [input.faultRunId, input.ownerId],
    );
    const row = asRecords(rows)[0];
    return row ? toExecutionRecord(row) : null;
  } finally {
    connection.release();
  }
}

export async function heartbeatFaultRunExecution(input: {
  faultRunId: string;
  ownerId: string;
  ownerEpoch: number;
  leaseTtlMs: number;
}): Promise<boolean> {
  assertLeaseTtl(input.leaseTtlMs);
  await verifyFaultRunOwnershipSchema();
  const [result] = await getPool().query(
    `UPDATE fault_run_executions execution
     JOIN fault_runs run ON run.fault_run_id = execution.fault_run_id
     SET execution.lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
         execution.last_heartbeat_at = CURRENT_TIMESTAMP(3),
         execution.last_action = 'HEARTBEAT',
         execution.last_action_at = CURRENT_TIMESTAMP(3)
     WHERE execution.fault_run_id = ?
       AND execution.owner_id = ?
       AND execution.owner_epoch = ?
       AND execution.lease_expires_at > CURRENT_TIMESTAMP(3)
       AND execution.reconciliation_state <> 'MANUAL_INTERVENTION_REQUIRED'
       AND run.state IN ('CREATING', 'ACTIVE', 'RECOVERING')`,
    [
      input.leaseTtlMs * 1000,
      input.faultRunId,
      input.ownerId,
      input.ownerEpoch,
    ],
  );
  return affectedRows(result) === 1;
}

export async function markFaultRunExecutionLeaseLost(input: {
  faultRunId: string;
  ownerId: string;
  ownerEpoch: number;
  errorCode: string;
}): Promise<boolean> {
  await verifyFaultRunOwnershipSchema();
  const [result] = await getPool().query(
    `UPDATE fault_run_executions
        SET lease_lost_at = CURRENT_TIMESTAMP(3),
            reconciliation_state = 'TAKEOVER_PENDING',
            drain_state = 'LEASE_LOST',
            last_action = 'OWNER_LEASE_LOST',
            last_action_at = CURRENT_TIMESTAMP(3),
            last_error_code = ?
      WHERE fault_run_id = ?
        AND owner_id = ?
        AND owner_epoch = ?`,
    [
      normalizeErrorCode(input.errorCode),
      input.faultRunId,
      input.ownerId,
      input.ownerEpoch,
    ],
  );
  return affectedRows(result) === 1;
}

export async function updateOwnedFaultRunExecution(
  input: UpdateOwnedFaultRunExecutionInput,
): Promise<boolean> {
  await verifyFaultRunOwnershipSchema();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.reconciliationState !== undefined) {
    fields.push('reconciliation_state = ?');
    values.push(input.reconciliationState);
  }
  if (input.drainState !== undefined) {
    fields.push('drain_state = ?');
    values.push(input.drainState);
  }
  if (input.drainDeadlineAt !== undefined) {
    fields.push('drain_deadline_at = ?');
    values.push(input.drainDeadlineAt);
  }
  if (input.lastAction !== undefined) {
    fields.push('last_action = ?');
    values.push(input.lastAction);
    fields.push('last_action_at = CURRENT_TIMESTAMP(3)');
  }
  if (input.lastErrorCode !== undefined) {
    fields.push('last_error_code = ?');
    values.push(input.lastErrorCode === null ? null : normalizeErrorCode(input.lastErrorCode));
  }
  if (fields.length === 0) return false;

  values.push(input.faultRunId, input.ownerId, input.ownerEpoch);
  const [result] = await getPool().query(
    `UPDATE fault_run_executions
        SET ${fields.join(', ')}
      WHERE fault_run_id = ? AND owner_id = ? AND owner_epoch = ?`,
    values,
  );
  return affectedRows(result) === 1;
}

export async function relinquishFaultRunExecution(input: {
  faultRunId: string;
  ownerId: string;
  ownerEpoch: number;
}): Promise<boolean> {
  await verifyFaultRunOwnershipSchema();
  const [result] = await getPool().query(
    `UPDATE fault_run_executions
        SET owner_id = NULL,
            lease_expires_at = CURRENT_TIMESTAMP(3),
            reconciliation_state = 'IDLE',
            drain_state = CASE
              WHEN drain_state = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
              ELSE 'DRAINED'
            END,
            last_action = 'OWNER_RELINQUISHED',
            last_action_at = CURRENT_TIMESTAMP(3)
      WHERE fault_run_id = ?
        AND owner_id = ?
        AND owner_epoch = ?
        AND drain_state IN ('DRAINED', 'NOT_APPLICABLE')`,
    [input.faultRunId, input.ownerId, input.ownerEpoch],
  );
  return affectedRows(result) === 1;
}

export function toExecutionRecord(row: Record<string, unknown>): FaultRunExecutionRecord {
  return {
    faultRunId: String(row.fault_run_id),
    executionMode: String(row.execution_mode) as FaultRunExecutionMode,
    ownerId: nullableString(row.owner_id),
    ownerEpoch: Number(row.owner_epoch),
    leaseAcquiredAt: nullableIso(row.lease_acquired_at),
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    lastHeartbeatAt: nullableIso(row.last_heartbeat_at),
    leaseLostAt: nullableIso(row.lease_lost_at),
    reconciledAt: nullableIso(row.reconciled_at),
    reconciliationState: String(row.reconciliation_state) as FaultRunReconciliationState,
    drainState: String(row.drain_state) as FaultRunDrainState,
    drainDeadlineAt: nullableIso(row.drain_deadline_at),
    lastAction: nullableString(row.last_action),
    lastActionAt: nullableIso(row.last_action_at),
    lastErrorCode: nullableString(row.last_error_code),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function assertLeaseTtl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_OWNER_LEASE_TTL');
}

function affectedRows(result: unknown): number {
  return Number(asRecord(result).affectedRows ?? 0);
}

function normalizeErrorCode(value: string): string {
  return /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(value) ? value : 'OWNER_EXECUTION_FAILED';
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
