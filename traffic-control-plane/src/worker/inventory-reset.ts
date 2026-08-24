import { getGatewayClient } from '../lib/gateway-client';
import { getRedis } from '../lib/redis';
import { loadResetPolicyFromDb, ResetPolicy, updateResetPolicyInDb } from '../lib/reset-policy';
import { clearRunnerOrderQueues, consumeInventoryPolicyReload, consumeInventoryResetTrigger } from '../lib/runtime-state';
import pino from 'pino';
import { CronExpressionParser } from 'cron-parser';

const log = pino({ name: 'inventory-reset' });

interface ApiResponseEnvelope<T> {
  code: string | number;
  message: string;
  data: T;
}

export class InventoryResetScheduler {
  private policy: ResetPolicy | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  async loadPolicy(): Promise<void> {
    this.policy = await loadResetPolicyFromDb();
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

  async updatePolicy(req: {
    cronExpr?: string;
    allowedWindow?: string;
    resetScope?: string;
    version: number;
  }): Promise<ResetPolicy> {
    this.policy = await updateResetPolicyInDb(req);
    // Re-schedule with new cron
    this.stop();
    this.start();
    return this.policy!;
  }

  async triggerNow(): Promise<{ success: boolean; message: string }> {
    return this.executeReset();
  }

  async syncIfNeeded(): Promise<void> {
    if (await consumeInventoryPolicyReload()) {
      await this.loadPolicy();
      this.stop();
      this.start();
    }
    if (await consumeInventoryResetTrigger()) {
      await this.executeReset();
    }
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
    if (!this.policy) {
      await this.loadPolicy();
    }
    if (!this.policy) {
      return { success: false, message: 'Reset policy not loaded' };
    }

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
        const plan = await gateway.post<ApiResponseEnvelope<Array<Record<string, unknown>>>>(
          '/internal/gateway/inventory-reset/plan',
          {}
        );
        const scope = this.policy.resetScope === 'ALL'
          ? 'ALL'
          : this.policy.resetScope.split(',').map((item) => item.trim()).filter(Boolean);

        const result = await gateway.post<ApiResponseEnvelope<Record<string, unknown>>>(
          '/internal/gateway/inventory-reset',
          {
            expectedVersion: this.policy.baselineVersion,
            scope,
          }
        );
        log.info({
          planSize: Array.isArray(plan.data) ? plan.data.length : 0,
          baselineVersion: this.policy.baselineVersion,
          scope,
          result: result.data,
        }, 'Inventory reset executed through gateway');
        await clearRunnerOrderQueues();
        return { success: true, message: 'Reset completed' };
      } finally {
        await redis.del(lockKey);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      log.error({ error: message }, 'Inventory reset failed');
      return { success: false, message };
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
