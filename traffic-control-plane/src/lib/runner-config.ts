import { getPool } from './db';

export interface MixRule {
  actionType: string;
  ratio: number;
}

export interface RunnerConfig {
  version: number;
  enabled: boolean;
  baseQps: number;
  peakMultiplier: number;
  cycleMinutes: number;
  jitterPct: number;
  maxItems: number;
  maxItemQuantity: number;
  paymentSuccessRatio: number;
  paymentFailureRatio: number;
  paymentUnknownRatio: number;
  mixRules: MixRule[];
}

export async function loadRunnerConfigFromDb(): Promise<RunnerConfig> {
  const pool = getPool();
  const [profiles] = await pool.query('SELECT * FROM runner_profile WHERE id = 1');
  const profile = (profiles as Record<string, unknown>[])[0];

  const [rules] = await pool.query('SELECT * FROM runner_mix_rule ORDER BY id');
  const mixRules = (rules as Record<string, unknown>[]).map((r) => ({
    actionType: String(r.action_type ?? ''),
    ratio: Number(r.ratio),
  }));
  const paymentSuccessRatio = Number(profile?.payment_success_ratio ?? 1);
  const paymentFailureRatio = Number(profile?.payment_failure_ratio ?? 0);
  const paymentUnknownRatio = Number(profile?.payment_unknown_ratio ?? 0);
  const isLegacyPaymentDefault = Number(profile?.version ?? 1) === 1
    && paymentSuccessRatio === 0.9
    && paymentFailureRatio === 0.05
    && paymentUnknownRatio === 0.05;

  return {
    version: Number(profile?.version ?? 1),
    enabled: Number(profile?.enabled ?? 1) === 1,
    baseQps: Number(profile?.base_qps ?? 5),
    peakMultiplier: Number(profile?.peak_multiplier ?? 2.0),
    cycleMinutes: Number(profile?.cycle_minutes ?? 10),
    jitterPct: Number(profile?.jitter_pct ?? 0.1),
    maxItems: Number(profile?.max_items ?? 3),
    maxItemQuantity: Number(profile?.max_item_quantity ?? 3),
    paymentSuccessRatio: isLegacyPaymentDefault ? 1 : paymentSuccessRatio,
    paymentFailureRatio: isLegacyPaymentDefault ? 0 : paymentFailureRatio,
    paymentUnknownRatio: isLegacyPaymentDefault ? 0 : paymentUnknownRatio,
    mixRules: mixRules.length > 0 ? mixRules : [
      { actionType: 'BROWSE_PRODUCT', ratio: 1 },
    ],
  };
}

export async function updateRunnerConfigInDb(req: {
  version: number;
  enabled?: boolean;
  baseQps?: number;
  peakMultiplier?: number;
  cycleMinutes?: number;
  jitterPct?: number;
  maxItems?: number;
  maxItemQuantity?: number;
  paymentSuccessRatio?: number;
  paymentFailureRatio?: number;
  paymentUnknownRatio?: number;
  mixRules?: MixRule[];
}): Promise<{ newVersion: number; enabled: boolean; appliedAt: string }> {
  const current = await loadRunnerConfigFromDb();
  const pool = getPool();
  const values = [
    req.baseQps ?? current.baseQps,
    req.peakMultiplier ?? current.peakMultiplier,
    req.cycleMinutes ?? current.cycleMinutes,
    req.jitterPct ?? current.jitterPct,
    req.maxItems ?? current.maxItems,
    req.maxItemQuantity ?? current.maxItemQuantity,
    req.paymentSuccessRatio ?? current.paymentSuccessRatio,
    req.paymentFailureRatio ?? current.paymentFailureRatio,
    req.paymentUnknownRatio ?? current.paymentUnknownRatio,
  ];
  if (!values.every(Number.isFinite)
      || values[0] < 1 || values[1] < 1 || values[2] < 1 || values[3] < 0 || values[3] > 1
      || values[4] < 1 || values[4] > 20 || values[5] < 1 || values[5] > 99
      || values.slice(6).some((value) => value < 0 || value > 1)
      || Math.abs(values.slice(6).reduce((sum, value) => sum + value, 0) - 1) > 0.0001) {
    throw new Error('INVALID_RUNNER_CONFIG');
  }
  const supportedActions = new Set([
    'BROWSE_PRODUCT', 'SEARCH_CATALOG', 'ADD_CART_ITEM', 'UPDATE_CART_ITEM',
    'CHECKOUT', 'PAYMENT_CONFIRM', 'CANCEL_PENDING_ORDER', 'QUERY_ORDER', 'QUERY_SHIPMENT',
  ]);
  if (req.mixRules && (req.mixRules.length === 0 || req.mixRules.some((rule) =>
    !supportedActions.has(rule.actionType) || !Number.isFinite(rule.ratio) || rule.ratio < 0))) {
    throw new Error('INVALID_RUNNER_MIX_RULES');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE runner_profile
       SET enabled = ?, base_qps = ?, peak_multiplier = ?, cycle_minutes = ?, jitter_pct = ?,
         max_items = ?, max_item_quantity = ?, payment_success_ratio = ?,
         payment_failure_ratio = ?, payment_unknown_ratio = ?, version = version + 1
       WHERE id = 1 AND version = ?`,
      [
        (req.enabled ?? current.enabled) ? 1 : 0,
        ...values,
        req.version,
      ]
    );

    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new Error('VERSION_CONFLICT');
    }

    if (req.mixRules) {
      await connection.query('DELETE FROM runner_mix_rule');
      for (const rule of req.mixRules) {
        await connection.query(
          'INSERT INTO runner_mix_rule (action_type, ratio, version) VALUES (?, ?, ?)',
          [rule.actionType, rule.ratio, req.version + 1]
        );
      }
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
