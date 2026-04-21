import { getPool } from '../lib/db';
import { getGatewayClient } from '../lib/gateway-client';
import { getRedis } from '../lib/redis';
import pino from 'pino';
import { CronExpressionParser } from 'cron-parser';

const log = pino({ name: 'inventory-reset' });

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

export class InventoryResetScheduler {
  private policy: ResetPolicy | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  async loadPolicy(): Promise<void> {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM runner_inventory_reset_policy WHERE id = 1');
    const data = (rows as any[])[0];
    if (data) {
      this.policy = {
        id: data.id,
        enabled: !!data.enabled,
        cronExpr: data.cron_expr,
        timezone: data.timezone,
        allowedWindow: data.allowed_window,
        resetScope: data.reset_scope,
        baselineVersion: data.baseline_version,
        version: data.version,
      };
    }
    log.info({ policy: this.policy }, 'Inventory reset policy loaded');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getPolicy(): ResetPolicy | null {
    return this.policy;
  }

  async updatePolicy(req: {
    cronExpr?: string;
    allowedWindow?: string;
    resetScope?: string;
    version: number;
  }): Promise<ResetPolicy> {
    const pool = getPool();
    const [result] = await pool.query(
      `UPDATE runner_inventory_reset_policy SET cron_expr = COALESCE(?, cron_expr), allowed_window = COALESCE(?, allowed_window), reset_scope = COALESCE(?, reset_scope), version = version + 1 WHERE id = 1 AND version = ?`,
      [req.cronExpr, req.allowedWindow, req.resetScope, req.version]
    );
    if ((result as any).affectedRows === 0) {
      throw new Error('VERSION_CONFLICT');
    }
    await this.loadPolicy();
    // Re-schedule with new cron
    this.stop();
    this.start();
    return this.policy!;
  }

  async triggerNow(): Promise<{ success: boolean; message: string }> {
    return this.executeReset();
  }

  // ── Private ──

  private scheduleNext(): void {
    if (!this.running || !this.policy?.enabled) return;
    try {
      const interval = CronExpressionParser.parse(this.policy.cronExpr, {
        tz: this.policy.timezone,
      });
      const next = interval.next().toDate();
      const delay = next.getTime() - Date.now();
      this.timer = setTimeout(async () => {
        if (this.isInAllowedWindow()) {
          await this.executeReset();
        }
        this.scheduleNext();
      }, Math.max(delay, 1000));
    } catch (e) {
      log.error({ error: e }, 'Failed to parse cron expression');
    }
  }

  private isInAllowedWindow(): boolean {
    if (!this.policy?.allowedWindow) return true;
    const [start, end] = this.policy.allowedWindow.split('-');
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return hhmm >= start && hhmm <= end;
  }

  private async executeReset(): Promise<{ success: boolean; message: string }> {
    const gateway = getGatewayClient();
    const redis = getRedis();
    const lockKey = 'castrel:inventory:reset-lock';

    try {
      // Acquire distributed lock
      const locked = await redis.set(lockKey, 'traffic-control-plane', 'EX', 120, 'NX');
      if (!locked) {
        return { success: false, message: 'Could not acquire lock' };
      }

      try {
        // Call gateway to trigger inventory reset
        await gateway.post('/api/orders', { action: 'inventory-reset' });
        log.info('Inventory reset executed');
        return { success: true, message: 'Reset completed' };
      } finally {
        await redis.del(lockKey);
      }
    } catch (e: any) {
      log.error({ error: e.message }, 'Inventory reset failed');
      return { success: false, message: e.message };
    }
  }
}

let scheduler: InventoryResetScheduler | null = null;

export function getInventoryResetScheduler(): InventoryResetScheduler {
  if (!scheduler) {
    scheduler = new InventoryResetScheduler();
  }
  return scheduler;
}
