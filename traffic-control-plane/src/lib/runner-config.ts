import { getPool } from './db';

export interface MixRule {
  actionType: string;
  ratio: number;
}

export interface RunnerConfig {
  version: number;
  baseQps: number;
  peakMultiplier: number;
  cycleMinutes: number;
  jitterPct: number;
  mixRules: MixRule[];
}

export async function loadRunnerConfigFromDb(): Promise<RunnerConfig> {
  const pool = getPool();
  const [profiles] = await pool.query('SELECT * FROM runner_profile WHERE id = 1');
  const profile = (profiles as any[])[0];

  const [rules] = await pool.query('SELECT * FROM runner_mix_rule ORDER BY id');
  const mixRules = (rules as any[]).map((r) => ({
    actionType: r.action_type,
    ratio: Number(r.ratio),
  }));

  return {
    version: Number(profile?.version ?? 1),
    baseQps: Number(profile?.base_qps ?? 5),
    peakMultiplier: Number(profile?.peak_multiplier ?? 2.0),
    cycleMinutes: Number(profile?.cycle_minutes ?? 10),
    jitterPct: Number(profile?.jitter_pct ?? 0.1),
    mixRules: mixRules.length > 0 ? mixRules : [
      { actionType: 'ORDER_SUCCESS', ratio: 0.9 },
      { actionType: 'CANCEL_ORDER', ratio: 0.1 },
    ],
  };
}

export async function updateRunnerConfigInDb(req: {
  version: number;
  baseQps?: number;
  peakMultiplier?: number;
  cycleMinutes?: number;
  jitterPct?: number;
  mixRules?: MixRule[];
}): Promise<{ newVersion: number; appliedAt: string }> {
  const current = await loadRunnerConfigFromDb();
  const pool = getPool();

  const [result] = await pool.query(
    `UPDATE runner_profile
     SET base_qps = ?, peak_multiplier = ?, cycle_minutes = ?, jitter_pct = ?, version = version + 1
     WHERE id = 1 AND version = ?`,
    [
      req.baseQps ?? current.baseQps,
      req.peakMultiplier ?? current.peakMultiplier,
      req.cycleMinutes ?? current.cycleMinutes,
      req.jitterPct ?? current.jitterPct,
      req.version,
    ]
  );

  if ((result as any).affectedRows === 0) {
    throw new Error('VERSION_CONFLICT');
  }

  if (req.mixRules) {
    await pool.query('DELETE FROM runner_mix_rule');
    for (const rule of req.mixRules) {
      await pool.query(
        'INSERT INTO runner_mix_rule (action_type, ratio, version) VALUES (?, ?, ?)',
        [rule.actionType, rule.ratio, req.version + 1]
      );
    }
  }

  return {
    newVersion: req.version + 1,
    appliedAt: new Date().toISOString(),
  };
}
