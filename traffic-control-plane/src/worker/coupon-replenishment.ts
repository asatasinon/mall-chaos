import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import pino from 'pino';
import { getGatewayClient, GatewayClient } from '../lib/gateway-client';
import { getRedis } from '../lib/redis';
import { recordReplenishmentRun } from '../lib/runner-persistence';
import { setCouponReplenishmentStatus } from '../lib/runtime-state';

const log = pino({ name: 'coupon-replenishment' });
const CRON_EXPRESSION = '0 0 */6 * * *';
const TIME_ZONE = 'UTC';
const LOCK_TTL_SECONDS = 120;
const COMPLETION_TTL_SECONDS = 7 * 60 * 60;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 5000];

interface ReplenishmentResponse {
  code?: string | number;
}

export interface CouponReplenishmentStatus {
  running: boolean;
  lastWindowId: string | null;
  lastResult: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  lastAttemptAt: string | null;
  nextExecutionAt: string | null;
  retryCount: number;
}

export interface CouponReplenishmentDependencies {
  gateway?: GatewayClient;
  redis?: ReturnType<typeof getRedis>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

export class CouponReplenishmentScheduler {
  private readonly gateway: GatewayClient;
  private readonly redis: ReturnType<typeof getRedis>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly instanceId = randomUUID();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private status: CouponReplenishmentStatus = {
    running: false,
    lastWindowId: null,
    lastResult: null,
    lastAttemptAt: null,
    nextExecutionAt: null,
    retryCount: 0,
  };

  constructor(dependencies: CouponReplenishmentDependencies = {}) {
    this.gateway = dependencies.gateway ?? getGatewayClient();
    this.redis = dependencies.redis ?? getRedis();
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
    this.now = dependencies.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.status = { ...this.status, running: true };
    await this.publishStatus();
    await this.executeCurrentWindow();
    this.scheduleNext();
    log.info({ status: this.status }, 'Coupon replenishment scheduler started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.status = { ...this.status, running: false, nextExecutionAt: null };
    void this.publishStatus();
    log.info({ status: this.status }, 'Coupon replenishment scheduler stopped');
  }

  getStatus(): CouponReplenishmentStatus {
    return { ...this.status };
  }

  async executeCurrentWindow(): Promise<CouponReplenishmentStatus> {
    const windowId = this.windowId(this.now());
    const correlationId = randomUUID();
    const completedKey = `traffic-control-plane:replenishment:coupon:completed:${windowId}`;
    const lockKey = 'traffic-control-plane:replenishment:coupon:lock';
    this.status = {
      ...this.status,
      lastWindowId: windowId,
      lastAttemptAt: this.now().toISOString(),
      retryCount: 0,
    };

    await this.redis.connect().catch(() => undefined);
    if (await this.redis.get(completedKey)) {
      this.status = { ...this.status, lastResult: 'COMPLETED' };
      await this.publishStatus();
      return this.getStatus();
    }

    const lockToken = `${this.instanceId}:${windowId}`;
    const acquired = await this.redis.set(lockKey, lockToken, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!acquired) {
      this.status = { ...this.status, lastResult: 'SKIPPED' };
      await this.publishStatus();
      log.info({ windowId }, 'Coupon replenishment skipped because another worker holds the lock');
      return this.getStatus();
    }

    const startedAt = this.now();
    let lastError: unknown = null;
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        this.status = { ...this.status, retryCount: attempt - 1 };
        try {
          const response = await this.gateway.postInternal<ReplenishmentResponse>(
            '/internal/gateway/promotions/demo-coupons/replenish', {}, correlationId);
          if (!isSuccessfulResponse(response)) {
            throw new Error('COUPON_REPLENISHMENT_REJECTED');
          }
          await this.redis.set(completedKey, 'completed', 'EX', COMPLETION_TTL_SECONDS);
          this.status = { ...this.status, lastResult: 'COMPLETED' };
          await this.publishStatus();
          await this.persistStatus(windowId, correlationId, startedAt, 'COMPLETED', attempt - 1, 'completed');
          return this.getStatus();
        } catch (error) {
          lastError = error;
          if (attempt < MAX_ATTEMPTS && this.inCurrentWindow(windowId)) {
            await this.sleep(BACKOFF_MS[attempt - 1]);
          }
        }
      }
      this.status = { ...this.status, lastResult: 'FAILED', retryCount: MAX_ATTEMPTS - 1 };
      await this.publishStatus();
      await this.persistStatus(windowId, correlationId, startedAt, 'FAILED', MAX_ATTEMPTS - 1, 'failed');
      log.error({ windowId, error: safeErrorMessage(lastError) }, 'Coupon replenishment failed');
      return this.getStatus();
    } finally {
      await this.redis.del(lockKey);
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    try {
      const interval = CronExpressionParser.parse(CRON_EXPRESSION, { tz: TIME_ZONE });
      const next = interval.next().toDate();
      this.status = { ...this.status, nextExecutionAt: next.toISOString() };
      void this.publishStatus();
      this.timer = setTimeout(async () => {
        if (!this.running) return;
        await this.executeCurrentWindow();
        this.scheduleNext();
      }, Math.max(next.getTime() - this.now().getTime(), 1000));
    } catch (error) {
      log.error({ error: safeErrorMessage(error) }, 'Failed to schedule coupon replenishment');
    }
  }

  private async publishStatus(): Promise<void> {
    await setCouponReplenishmentStatus(this.getStatus());
  }

  private inCurrentWindow(windowId: string): boolean {
    return windowId === this.windowId(this.now());
  }

  private windowId(date: Date): string {
    return `UTC-6H-${Math.floor(date.getTime() / 1000 / (6 * 60 * 60))}`;
  }

  private async persistStatus(
    windowId: string,
    correlationId: string,
    startedAt: Date,
    status: 'COMPLETED' | 'FAILED',
    retryCount: number,
    resultSummary: string,
  ): Promise<void> {
    try {
      await recordReplenishmentRun({
        windowId,
        operationType: 'DEMO_COUPON_REPLENISH',
        status,
        startedAt,
        completedAt: this.now(),
        retryCount,
        resultSummary,
        correlationId,
      });
    } catch (error) {
      log.warn({ windowId, error: safeErrorMessage(error) }, 'Failed to persist coupon scheduler status');
    }
  }
}

function isSuccessfulResponse(response: ReplenishmentResponse): boolean {
  return response.code === undefined || response.code === 0 || response.code === 200 || response.code === '200';
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'COUPON_REPLENISHMENT_FAILED';
}

let scheduler: CouponReplenishmentScheduler | null = null;

export function getCouponReplenishmentScheduler(): CouponReplenishmentScheduler {
  if (!scheduler) {
    scheduler = new CouponReplenishmentScheduler();
  }
  return scheduler;
}
