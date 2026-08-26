import crypto from 'node:crypto';
import { getPool } from './db';

export async function recordOperatorAudit(input: {
  request: Request;
  action: string;
  target?: string;
  parameters?: unknown;
  result: 'SUCCESS' | 'FAILURE';
  correlationId?: string;
}): Promise<number> {
  const operatorIdHeader = input.request.headers.get('x-operator-id');
  const operatorId = operatorIdHeader && /^\d+$/.test(operatorIdHeader)
    ? Number(operatorIdHeader)
    : null;
  const parameterHash = input.parameters === undefined
    ? null
    : crypto.createHash('sha256')
      .update(JSON.stringify(input.parameters))
      .digest('hex');

  const [result] = await getPool().execute(
    `INSERT INTO operator_audit_logs
      (operator_id, action, target, parameter_hash, result, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [operatorId, input.action, input.target ?? null, parameterHash, input.result, input.correlationId ?? null],
  );
  return Number((result as { insertId?: number }).insertId ?? 0);
}
