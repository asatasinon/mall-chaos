import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import pino from 'pino';
import { getGatewayClient, GatewayClient } from '../lib/gateway-client';
import { getRedis } from '../lib/redis';
import { recordReplenishmentRun, type ReplenishmentRunRecord } from '../lib/runner-persistence';
import { setCouponReplenishmentStatus } from '../lib/runtime-state';

const log = pino({ name: 'coupon-replenishment' });
const CRON_EXPRESSION = '0 0 */6 * * *';
const TIME_ZONE = 'UTC';
const LOCK_TTL_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 120_000;
const COMPLETION_TTL_SECONDS = 7 * 60 * 60;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 5000];

interface ReplenishmentResponse {
  code?: string | number;
  data?: ReplenishmentData | ReplenishmentEnvelope<ReplenishmentData>;
}

interface ReplenishmentData {
  addedCount?: number;
  skippedCount?: number;
  failedCount?: number;
}

interface ReplenishmentEnvelope<T> {
  code?: string | number;
  data?: T;
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
  statusPublisher?: (status: CouponReplenishmentStatus) => Promise<void>;
  persistenceWriter?: (record: ReplenishmentRunRecord) => Promise<void>;
}

export class CouponReplenishmentScheduler {
  private readonly gateway: GatewayClient;
  private readonly redis: ReturnType<typeof getRedis>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly statusPublisher: (status: CouponReplenishmentStatus) => Promise<void>;
  private readonly persistenceWriter: (record: ReplenishmentRunRecord) => Promise<void>;
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
    this.statusPublisher = dependencies.statusPublisher ?? setCouponReplenishmentStatus;
    this.persistenceWriter = dependencies.persistenceWriter ?? recordReplenishmentRun;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.status = { ...this.status, running: true };
    await this.publishStatus();
    await this.executeScheduledWindow();
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

  async executeScheduledWindow(): Promise<CouponReplenishmentStatus> {
    return this.execute(this.windowId(this.now()), true, randomUUID());
  }

  async executeManual(correlationId: string = randomUUID()): Promise<CouponReplenishmentStatus> {
    return this.execute(`manual:${randomUUID()}`, false, correlationId);
  }

  private async execute(
    runId: string,
    scheduled: boolean,
    correlationId: string,
  ): Promise<CouponReplenishmentStatus> {
    const completedKey = scheduled
      ? `traffic-control-plane:replenishment:coupon:completed:${runId}`
      : null;
    const lockKey = 'traffic-control-plane:replenishment:coupon:lock';
    this.status = {
      ...this.status,
      lastWindowId: runId,
      lastAttemptAt: this.now().toISOString(),
      retryCount: 0,
    };
    await this.publishStatus();

    await this.redis.connect().catch(() => undefined);
    if (completedKey && await this.redis.get(completedKey)) {
      this.status = { ...this.status, lastResult: 'COMPLETED' };
      await this.publishStatus();
      return this.getStatus();
    }

    const lockToken = `${this.instanceId}:${runId}`;
    const acquired = await this.redis.set(lockKey, lockToken, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!acquired) {
      this.status = { ...this.status, lastResult: 'SKIPPED' };
      await this.publishStatus();
      log.info({ runId }, 'Coupon replenishment skipped because another worker holds the lock');
      return this.getStatus();
    }

    const startedAt = this.now();
    let lastError: unknown = null;
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        this.status = { ...this.status, retryCount: attempt - 1 };
        try {
          const response = await this.gateway.postInternal<ReplenishmentResponse>(
            '/internal/gateway/promotions/demo-coupons/replenish', {}, correlationId,
            AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            { 'X-Replenishment-Run-Id': runId });
          const data = extractReplenishmentData(response);
          if (!data || numberOrZero(data.failedCount) > 0) {
            throw new Error('COUPON_REPLENISHMENT_REJECTED');
          }
          if (completedKey) {
            await this.redis.set(completedKey, 'completed', 'EX', COMPLETION_TTL_SECONDS);
          }
          this.status = { ...this.status, lastResult: 'COMPLETED' };
          await this.publishStatus();
          await this.persistStatus(runId, correlationId, startedAt, 'COMPLETED', attempt - 1, data);
          return this.getStatus();
        } catch (error) {
          lastError = error;
          if (attempt < MAX_ATTEMPTS && (!scheduled || this.inCurrentWindow(runId))) {
            await this.sleep(BACKOFF_MS[attempt - 1]);
          }
        }
      }
      this.status = { ...this.status, lastResult: 'FAILED', retryCount: MAX_ATTEMPTS - 1 };
      await this.publishStatus();
      await this.persistStatus(runId, correlationId, startedAt, 'FAILED', MAX_ATTEMPTS - 1, {});
      log.error({ runId, error: safeErrorMessage(lastError) }, 'Coupon replenishment failed');
      return this.getStatus();
    } finally {
      await this.releaseLock(lockKey, lockToken);
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    try {
      const interval = CronExpressionParser.parse(CRON_EXPRESSION, {
        currentDate: this.now(),
        tz: TIME_ZONE,
      });
      const next = interval.next().toDate();
      this.status = { ...this.status, nextExecutionAt: next.toISOString() };
      void this.publishStatus();
      this.timer = setTimeout(async () => {
        if (!this.running) return;
        await this.executeScheduledWindow();
        this.scheduleNext();
      }, Math.max(next.getTime() - this.now().getTime(), 1000));
    } catch (error) {
      log.error({ error: safeErrorMessage(error) }, 'Failed to schedule coupon replenishment');
    }
  }

  private async publishStatus(): Promise<void> {
    try {
      await this.statusPublisher(this.getStatus());
    } catch (error) {
      log.warn({ error: safeErrorMessage(error) }, 'Failed to publish coupon replenishment status');
    }
  }

  private async releaseLock(lockKey: string, lockToken: string): Promise<void> {
    try {
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    } catch (error) {
      log.warn({ lockKey, error: safeErrorMessage(error) }, 'Failed to release coupon replenishment lock');
    }
  }

  private inCurrentWindow(windowId: string): boolean {
    return windowId === this.windowId(this.now());
  }

  private windowId(date: Date): string {
    return `UTC-6H-${Math.floor(date.getTime() / 1000 / (6 * 60 * 60))}`;
  }

  private async persistStatus(
    runId: string,
    correlationId: string,
    startedAt: Date,
    status: 'COMPLETED' | 'FAILED',
    retryCount: number,
    data: ReplenishmentData,
  ): Promise<void> {
    try {
      await this.persistenceWriter({
        windowId: runId,
        operationType: 'DEMO_COUPON_REPLENISH',
        status,
        startedAt,
        completedAt: this.now(),
        retryCount,
        resultSummary: `added=${numberOrZero(data.addedCount)},skipped=${numberOrZero(data.skippedCount)},failed=${numberOrZero(data.failedCount)}`,
        correlationId,
      });
    } catch (error) {
      log.warn({ runId, error: safeErrorMessage(error) }, 'Failed to persist coupon scheduler status');
    }
  }
}

function extractReplenishmentData(response: ReplenishmentResponse): ReplenishmentData | null {
  if (!isSuccessfulCode(response.code)) return null;
  if (isReplenishmentEnvelope(response.data)) {
    return isSuccessfulCode(response.data.code) ? response.data.data ?? {} : null;
  }
  return response.data ?? {};
}

function isSuccessfulCode(code: string | number | undefined): boolean {
  return code === undefined || code === 0 || code === 200 || code === '200';
}

function isReplenishmentEnvelope(value: ReplenishmentResponse['data']): value is ReplenishmentEnvelope<ReplenishmentData> {
  return typeof value === 'object' && value !== null && 'code' in value && 'data' in value;
}

function numberOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

export async function runManualCouponReplenishment(
  correlationId: string,
): Promise<CouponReplenishmentStatus> {
  return new CouponReplenishmentScheduler({
    statusPublisher: async () => undefined,
  }).executeManual(correlationId);
}
