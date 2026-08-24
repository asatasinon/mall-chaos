import { getPool } from './db';

export interface ResetPolicy {
  id: number;
  enabled: boolean;
  cronExpr: string;
  timezone: string;
  allowedWindow: string;
  resetScope: string;
  baselineVersion: number;
  version: number;
}

export async function loadResetPolicyFromDb(): Promise<ResetPolicy | null> {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM runner_inventory_reset_policy WHERE id = 1');
  const data = (rows as Record<string, unknown>[])[0];
  if (!data) {
    return null;
  }

  return {
    id: Number(data.id),
    enabled: !!data.enabled,
    cronExpr: String(data.cron_expr ?? ''),
    timezone: String(data.timezone ?? ''),
    allowedWindow: String(data.allowed_window ?? ''),
    resetScope: String(data.reset_scope ?? ''),
    baselineVersion: Number(data.baseline_version),
    version: Number(data.version),
  };
}

export async function updateResetPolicyInDb(req: {
  cronExpr?: string;
  allowedWindow?: string;
  resetScope?: string;
  version: number;
}): Promise<ResetPolicy> {
  const pool = getPool();
  const [result] = await pool.query(
    `UPDATE runner_inventory_reset_policy
     SET cron_expr = COALESCE(?, cron_expr),
         allowed_window = COALESCE(?, allowed_window),
         reset_scope = COALESCE(?, reset_scope),
         version = version + 1
     WHERE id = 1 AND version = ?`,
    [req.cronExpr, req.allowedWindow, req.resetScope, req.version]
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    throw new Error('VERSION_CONFLICT');
  }
  return (await loadResetPolicyFromDb())!;
}
