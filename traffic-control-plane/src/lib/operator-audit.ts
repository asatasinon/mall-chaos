import crypto from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { getPool } from './db';

export interface OperatorAuditInsertInput {
  operatorId: number | null;
  action: string;
  target?: string;
  parameters?: unknown;
  result: 'SUCCESS' | 'FAILURE';
  correlationId?: string;
}

export type OperatorAuditConnection = Pick<Pool, 'execute'>;

export async function recordOperatorAudit(input: {
  request: Request;
  action: string;
  target?: string;
  parameters?: unknown;
  result: 'SUCCESS' | 'FAILURE';
  correlationId?: string;
}): Promise<number> {
  return insertOperatorAudit(getPool(), {
    operatorId: getOperatorAuditOperatorId(input.request),
    action: input.action,
    target: input.target,
    parameters: input.parameters,
    result: input.result,
    correlationId: input.correlationId,
  });
}

export function getOperatorAuditOperatorId(request: Request): number | null {
  const operatorIdHeader = request.headers.get('x-operator-id');
  return operatorIdHeader && /^\d+$/.test(operatorIdHeader)
    ? Number(operatorIdHeader)
    : null;
}

export async function insertOperatorAudit(
  connection: OperatorAuditConnection,
  input: OperatorAuditInsertInput,
): Promise<number> {
  const parameterHash = input.parameters === undefined
    ? null
    : crypto.createHash('sha256')
      .update(JSON.stringify(input.parameters))
      .digest('hex');
  const [result] = await connection.execute(
    `INSERT INTO operator_audit_logs
      (operator_id, action, target, parameter_hash, result, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.operatorId,
      input.action,
      input.target ?? null,
      parameterHash,
      input.result,
      input.correlationId ?? null,
    ],
  );
  return Number((result as { insertId?: number }).insertId ?? 0);
}

export async function updateOperatorAuditResult(
  auditId: number,
  result: 'SUCCESS' | 'FAILURE',
): Promise<void> {
  await getPool().execute(
    'UPDATE operator_audit_logs SET result = ? WHERE id = ?',
    [result, auditId],
  );
}
