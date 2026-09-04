import { getPool } from './db';
import { LIFECYCLE_INTERVALS } from './runner-config-constants';

export { LIFECYCLE_INTERVALS } from './runner-config-constants';
export type TrafficMode = 'CUSTOMER_LIFECYCLE';

const RUNNER_CONFIG_FIELDS = new Set([
  'version', 'enabled', 'trafficMode', 'lifecycleIntervalSec', 'maxItems',
  'maxItemQuantity', 'successfulPaymentRatio', 'couponUsageRatio',
  'backgroundActionsEnabled',
]);

export interface RunnerConfig {
  version: number;
  enabled: boolean;
  trafficMode: TrafficMode;
  lifecycleIntervalSec: (typeof LIFECYCLE_INTERVALS)[number];
  maxItems: number;
  maxItemQuantity: number;
  successfulPaymentRatio: number;
  couponUsageRatio: number;
  backgroundActionsEnabled: boolean;
}

export interface RunnerConfigUpdate {
  version: number;
  enabled?: boolean;
  trafficMode?: TrafficMode;
  lifecycleIntervalSec?: number;
  maxItems?: number;
  maxItemQuantity?: number;
  successfulPaymentRatio?: number;
  couponUsageRatio?: number;
  backgroundActionsEnabled?: boolean;
}

export async function loadRunnerConfigFromDb(): Promise<RunnerConfig> {
  const pool = getPool();
  const [profiles] = await pool.query(
    `SELECT id, enabled, traffic_mode, lifecycle_interval_sec, max_items,
            max_item_quantity, successful_payment_ratio, coupon_usage_ratio,
            background_actions_enabled, version
     FROM runner_profile
     WHERE id = 1`,
  );
  const profile = (profiles as Record<string, unknown>[])[0];
  const interval = Number(profile?.lifecycle_interval_sec ?? 60);
  const lifecycleIntervalSec = LIFECYCLE_INTERVALS.includes(
    interval as (typeof LIFECYCLE_INTERVALS)[number],
  ) ? interval as (typeof LIFECYCLE_INTERVALS)[number] : 60;

  return {
    version: Number(profile?.version ?? 1),
    enabled: Number(profile?.enabled ?? 1) === 1,
    trafficMode: 'CUSTOMER_LIFECYCLE',
    lifecycleIntervalSec,
    maxItems: Number(profile?.max_items ?? 3),
    maxItemQuantity: Number(profile?.max_item_quantity ?? 3),
    successfulPaymentRatio: Number(profile?.successful_payment_ratio ?? 1),
    couponUsageRatio: Number(profile?.coupon_usage_ratio ?? 0),
    backgroundActionsEnabled: Number(profile?.background_actions_enabled ?? 0) === 1,
  };
}

export async function updateRunnerConfigInDb(req: RunnerConfigUpdate): Promise<{ newVersion: number; enabled: boolean; appliedAt: string }> {
  const current = await loadRunnerConfigFromDb();
  validateRunnerConfigUpdate(req, current);
  const trafficMode = req.trafficMode ?? current.trafficMode;
  const lifecycleIntervalSec = req.lifecycleIntervalSec ?? current.lifecycleIntervalSec;
  const maxItems = req.maxItems ?? current.maxItems;
  const maxItemQuantity = req.maxItemQuantity ?? current.maxItemQuantity;
  const successfulPaymentRatio = req.successfulPaymentRatio ?? current.successfulPaymentRatio;
  const couponUsageRatio = req.couponUsageRatio ?? current.couponUsageRatio;

  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE runner_profile
       SET enabled = ?, traffic_mode = ?, lifecycle_interval_sec = ?, max_items = ?,
         max_item_quantity = ?, successful_payment_ratio = ?, coupon_usage_ratio = ?,
         background_actions_enabled = ?, version = version + 1
       WHERE id = 1 AND version = ?`,
      [
        (req.enabled ?? current.enabled) ? 1 : 0,
        trafficMode,
        lifecycleIntervalSec,
        maxItems,
        maxItemQuantity,
        successfulPaymentRatio,
        couponUsageRatio,
        (req.backgroundActionsEnabled ?? current.backgroundActionsEnabled) ? 1 : 0,
        req.version,
      ]
    );

    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new Error('VERSION_CONFLICT');
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    newVersion: req.version + 1,
    enabled: req.enabled ?? current.enabled,
    appliedAt: new Date().toISOString(),
  };
}

export function validateRunnerConfigUpdate(
  req: RunnerConfigUpdate,
  current: RunnerConfig,
): void {
  if (Object.keys(req).some((key) => !RUNNER_CONFIG_FIELDS.has(key))
      || !Number.isInteger(req.version)
      || (req.enabled !== undefined && typeof req.enabled !== 'boolean')
      || (req.backgroundActionsEnabled !== undefined && typeof req.backgroundActionsEnabled !== 'boolean')) {
    throw new Error('INVALID_RUNNER_CONFIG');
  }

  const trafficMode = req.trafficMode ?? current.trafficMode;
  const lifecycleIntervalSec = req.lifecycleIntervalSec ?? current.lifecycleIntervalSec;
  const maxItems = req.maxItems ?? current.maxItems;
  const maxItemQuantity = req.maxItemQuantity ?? current.maxItemQuantity;
  const successfulPaymentRatio = req.successfulPaymentRatio ?? current.successfulPaymentRatio;
  const couponUsageRatio = req.couponUsageRatio ?? current.couponUsageRatio;
  if (trafficMode !== 'CUSTOMER_LIFECYCLE'
      || !LIFECYCLE_INTERVALS.includes(lifecycleIntervalSec as (typeof LIFECYCLE_INTERVALS)[number])
      || ![maxItems, maxItemQuantity, successfulPaymentRatio, couponUsageRatio].every(Number.isFinite)
      || maxItems < 1 || maxItems > 20
      || maxItemQuantity < 1 || maxItemQuantity > 99
      || successfulPaymentRatio < 0 || successfulPaymentRatio > 1
      || couponUsageRatio < 0 || couponUsageRatio > 1) {
    throw new Error('INVALID_RUNNER_CONFIG');
  }
}
