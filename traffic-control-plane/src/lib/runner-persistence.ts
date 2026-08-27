import { getPool } from './db';

export interface TrafficActionRecord {
  trafficRunId: string;
  actionId: string;
  lifecycleId?: string;
  customerId: number;
  actionType: string;
  status: 'SUCCESS' | 'FAILED' | 'NOOP';
  orderId?: string;
  paymentId?: string;
  cartVersion?: number;
  resultCode?: string;
  errorCode?: string;
  traceId: string;
  latencyMs: number;
}

export type TrafficLifecycleRecord = Omit<TrafficActionRecord, 'actionType' | 'lifecycleId'> & {
  lifecycleId: string;
};

export interface ReplenishmentRunRecord {
  windowId: string;
  operationType: 'DEMO_COUPON_REPLENISH' | 'DEMO_STOCK_REPLENISH';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: Date;
  completedAt?: Date;
  retryCount: number;
  resultSummary?: string;
  correlationId: string;
}

export async function ensureTrafficRun(trafficRunId: string, configVersion: number): Promise<void> {
  await getPool().query(
    `INSERT INTO traffic_runs (traffic_run_id, status, config_version)
     VALUES (?, 'RUNNING', ?)
     ON DUPLICATE KEY UPDATE status = 'RUNNING', config_version = VALUES(config_version)`,
    [trafficRunId, configVersion],
  );
}

export async function completeTrafficRun(trafficRunId: string): Promise<void> {
  await getPool().query(
    `UPDATE traffic_runs
     SET status = 'COMPLETED', ended_at = CURRENT_TIMESTAMP
     WHERE traffic_run_id = ? AND status = 'RUNNING'`,
    [trafficRunId],
  );
}

export async function recordTrafficAction(record: TrafficActionRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO traffic_actions
      (traffic_run_id, lifecycle_id, action_id, customer_id, action_type, status,
       order_id, payment_id, cart_version, result_code, error_code,
       trace_id, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.trafficRunId,
      record.lifecycleId ?? null,
      record.actionId,
      record.customerId,
      record.actionType,
      record.status,
      record.orderId ?? null,
      record.paymentId ?? null,
      record.cartVersion ?? null,
      record.resultCode ?? null,
      record.errorCode ?? null,
      record.traceId,
      record.latencyMs,
    ],
  );
}

export async function recordTrafficLifecycle(record: TrafficLifecycleRecord): Promise<void> {
  await recordTrafficAction({ ...record, actionType: 'CUSTOMER_LIFECYCLE' });
}

export async function loadTrafficActionsByLifecycleId(
  trafficRunId: string,
  lifecycleId: string,
): Promise<Array<Record<string, unknown>>> {
  const [rows] = await getPool().query(
    `SELECT action_id, lifecycle_id, customer_id, action_type, status, order_id,
            payment_id, cart_version, result_code, error_code, trace_id, latency_ms, created_at
     FROM traffic_actions
     WHERE traffic_run_id = ? AND lifecycle_id = ?
     ORDER BY created_at, id`,
    [trafficRunId, lifecycleId],
  );
  return rows as Array<Record<string, unknown>>;
}

export async function recordReplenishmentRun(record: ReplenishmentRunRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO traffic_replenishment_runs
      (window_id, operation_type, status, started_at, completed_at, retry_count,
       result_summary, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = VALUES(completed_at),
       retry_count = VALUES(retry_count), result_summary = VALUES(result_summary)`,
    [
      record.windowId,
      record.operationType,
      record.status,
      record.startedAt,
      record.completedAt ?? null,
      record.retryCount,
      record.resultSummary ?? null,
      record.correlationId,
    ],
  );
}
