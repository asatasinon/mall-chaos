import { getPool } from '../lib/db';
import { getGatewayClient } from '../lib/gateway-client';
import pino from 'pino';

const log = pino({ name: 'runner-engine' });

export interface RunnerConfig {
  version: number;
  baseQps: number;
  peakMultiplier: number;
  cycleMinutes: number;
  jitterPct: number;
  mixRules: MixRule[];
}

export interface MixRule {
  actionType: string;
  ratio: number;
}

interface SlidingEntry {
  ts: number;
  success: boolean;
}

const WINDOW_SECONDS = 60;
const SKUS = Array.from({ length: 50 }, (_, i) => `SKU-${String(i + 1).padStart(3, '0')}`);
const USER_COUNT = 20;

export class RunnerEngine {
  private config: RunnerConfig;
  private rateMultiplier = 1.0;
  private paused = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private window: SlidingEntry[] = [];
  private totalRequests = 0;
  private gateway = getGatewayClient();

  constructor() {
    this.config = {
      version: 1,
      baseQps: 5,
      peakMultiplier: 2.0,
      cycleMinutes: 10,
      jitterPct: 0.1,
      mixRules: [{ actionType: 'ORDER_SUCCESS', ratio: 1.0 }],
    };
  }

  async loadConfigFromDb(): Promise<void> {
    const pool = getPool();
    const [profiles] = await pool.query('SELECT * FROM runner_profile WHERE id = 1');
    const rows = profiles as any[];
    if (rows.length > 0) {
      const p = rows[0];
      this.config.version = p.version;
      this.config.baseQps = p.base_qps;
      this.config.peakMultiplier = p.peak_multiplier;
      this.config.cycleMinutes = p.cycle_minutes;
      this.config.jitterPct = p.jitter_pct;
    }

    const [rules] = await pool.query('SELECT * FROM runner_mix_rule ORDER BY id');
    const ruleRows = rules as any[];
    if (ruleRows.length > 0) {
      this.config.mixRules = ruleRows.map((r: any) => ({
        actionType: r.action_type,
        ratio: r.ratio,
      }));
    }
    log.info({ config: this.config }, 'Config loaded from DB');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleTick();
    log.info('Runner engine started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log.info('Runner engine stopped');
  }

  pause(): void {
    this.paused = true;
    log.info('Runner paused');
  }

  resume(): void {
    this.paused = false;
    log.info('Runner resumed');
  }

  setRateMultiplier(multiplier: number): void {
    this.rateMultiplier = multiplier;
    log.info({ multiplier }, 'Rate multiplier updated');
  }

  getStatus() {
    const now = Date.now();
    const cutoff = now - WINDOW_SECONDS * 1000;
    this.window = this.window.filter((e) => e.ts >= cutoff);
    const windowTotal = this.window.length;
    const windowSuccess = this.window.filter((e) => e.success).length;
    const windowFail = windowTotal - windowSuccess;

    return {
      running: this.running && !this.paused,
      paused: this.paused,
      currentQps: windowTotal > 0 ? +(windowTotal / WINDOW_SECONDS).toFixed(2) : 0,
      successRate: windowTotal > 0 ? +(windowSuccess / windowTotal).toFixed(4) : 0,
      failRate: windowTotal > 0 ? +(windowFail / windowTotal).toFixed(4) : 0,
      totalRequests: this.totalRequests,
      windowSeconds: WINDOW_SECONDS,
      rateMultiplier: this.rateMultiplier,
    };
  }

  getConfig(): RunnerConfig {
    return { ...this.config };
  }

  async updateConfig(req: {
    version: number;
    baseQps?: number;
    peakMultiplier?: number;
    cycleMinutes?: number;
    jitterPct?: number;
    mixRules?: MixRule[];
  }): Promise<{ newVersion: number; appliedAt: string }> {
    const pool = getPool();
    const [result] = await pool.query(
      `UPDATE runner_profile SET base_qps = ?, peak_multiplier = ?, cycle_minutes = ?, jitter_pct = ?, version = version + 1 WHERE id = 1 AND version = ?`,
      [
        req.baseQps ?? this.config.baseQps,
        req.peakMultiplier ?? this.config.peakMultiplier,
        req.cycleMinutes ?? this.config.cycleMinutes,
        req.jitterPct ?? this.config.jitterPct,
        req.version,
      ]
    );
    const updateResult = result as any;
    if (updateResult.affectedRows === 0) {
      throw new Error('VERSION_CONFLICT');
    }

    this.config = {
      ...this.config,
      version: req.version + 1,
      baseQps: req.baseQps ?? this.config.baseQps,
      peakMultiplier: req.peakMultiplier ?? this.config.peakMultiplier,
      cycleMinutes: req.cycleMinutes ?? this.config.cycleMinutes,
      jitterPct: req.jitterPct ?? this.config.jitterPct,
      mixRules: req.mixRules ?? this.config.mixRules,
    };

    return {
      newVersion: this.config.version,
      appliedAt: new Date().toISOString(),
    };
  }

  // ── Private ──

  private effectiveQps(): number {
    const { baseQps, peakMultiplier, cycleMinutes, jitterPct } = this.config;
    const cycleSec = cycleMinutes * 60;
    const phase = ((Date.now() / 1000) % cycleSec) / cycleSec;
    const wave = 1 + (peakMultiplier - 1) * Math.sin(phase * Math.PI * 2);
    const jitter = 1 + (Math.random() * 2 - 1) * jitterPct;
    return baseQps * wave * jitter * this.rateMultiplier;
  }

  private scheduleTick(): void {
    if (!this.running) return;
    const qps = Math.max(this.effectiveQps(), 0.1);
    const delayMs = 1000 / qps;
    this.timer = setTimeout(() => {
      this.tick();
      this.scheduleTick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.paused) return;
    const action = this.pickAction();
    this.totalRequests++;
    const success = await this.executeAction(action);
    this.window.push({ ts: Date.now(), success });
  }

  private pickAction(): string {
    const rand = Math.random();
    let cumulative = 0;
    for (const rule of this.config.mixRules) {
      cumulative += rule.ratio;
      if (rand <= cumulative) return rule.actionType;
    }
    return this.config.mixRules[0]?.actionType ?? 'ORDER_SUCCESS';
  }

  private async executeAction(action: string): Promise<boolean> {
    if (action === 'CANCEL') return true;

    const userId = Math.floor(Math.random() * USER_COUNT) + 1;
    const sku = SKUS[Math.floor(Math.random() * SKUS.length)];
    const qty = Math.floor(Math.random() * 3) + 1;
    const orderNo = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const resp = await this.gateway.post<any>('/api/orders', {
        orderNo,
        userId,
        sku,
        qty,
      });
      return resp?.data?.status === 'PAID';
    } catch {
      return false;
    }
  }
}

// Singleton
let engine: RunnerEngine | null = null;

export function getRunnerEngine(): RunnerEngine {
  if (!engine) {
    engine = new RunnerEngine();
  }
  return engine;
}
