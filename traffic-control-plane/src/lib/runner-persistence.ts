import { getPool } from './db';

export interface RunnerOrderRef {
  customerId: number;
  orderId: string;
  orderNo?: string;
  paymentId?: string;
}

export interface TrafficActionRecord {
  trafficRunId: string;
  actionId: string;
  customerId: number;
  actionType: string;
  status: 'SUCCESS' | 'FAILED' | 'NOOP';
  orderId?: string;
  paymentId?: string;
  cartVersion?: number;
  resultCode?: string;
  errorCode?: string;
  paymentStrategy?: string;
  traceId: string;
  latencyMs: number;
}

export async function loadRunnerCustomerIds(): Promise<number[]> {
  const [rows] = await getPool().query(
    `SELECT w.customer_id
     FROM runner_customer_whitelist w
     INNER JOIN users u ON u.id = w.customer_id
     WHERE w.enabled = 1 AND u.status = 1
     ORDER BY w.customer_id`,
  );
  const customerIds = (rows as Array<{ customer_id: number }>).map((row) => Number(row.customer_id));
  if (customerIds.length === 0) {
    throw new Error('RUNNER_CUSTOMER_WHITELIST_EMPTY');
  }
  return customerIds;
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
      (traffic_run_id, action_id, customer_id, action_type, status, order_id,
       payment_id, cart_version, result_code, error_code, payment_strategy,
       trace_id, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.trafficRunId,
      record.actionId,
      record.customerId,
      record.actionType,
      record.status,
      record.orderId ?? null,
      record.paymentId ?? null,
      record.cartVersion ?? null,
      record.resultCode ?? null,
      record.errorCode ?? null,
      record.paymentStrategy ?? null,
      record.traceId,
      record.latencyMs,
    ],
  );
}
