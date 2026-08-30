import { getRedis } from './redis';

const CONTROL_KEY = 'traffic-control-plane:runner:control';
const STATUS_KEY = 'traffic-control-plane:runner:status';
const INVENTORY_REPLENISHMENT_STATUS_KEY = 'traffic-control-plane:replenishment:inventory:status';
const COUPON_REPLENISHMENT_STATUS_KEY = 'traffic-control-plane:replenishment:coupon:status';
const REPLENISHMENT_STATUS_TTL_SECONDS = 7 * 60 * 60;

export interface RunnerControlState {
  paused: boolean;
}

export interface RunnerStatusState {
  running: boolean;
  enabled: boolean;
  paused: boolean;
  trafficMode: 'CUSTOMER_LIFECYCLE';
  lifecycleIntervalSec: number;
  configVersion: number;
  trafficRunId: string | null;
  currentLifecycleId: string | null;
  lastLifecycleStartedAt: string | null;
  lastLifecycleCompletedAt: string | null;
  lifecycleStartedCount: number;
  lifecycleCompletedCount: number;
  lifecycleNoopCount: number;
  lifecycleFailedCount: number;
  lifecycleInterruptedCount: number;
  averageIntervalSec: number | null;
  paymentSuccessCount: number;
  cancelCount: number;
  couponRequestedCount: number;
  couponAppliedCount: number;
  addressCreatedCount: number;
  cartReusedCount: number;
  pendingPaymentRetainedCount: number;
  updatedAt: string;
}

export async function getRunnerControlState(): Promise<RunnerControlState> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const data = await redis.hgetall(CONTROL_KEY);
  return {
    paused: data.paused === 'true',
  };
}

export async function setRunnerPaused(paused: boolean): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.hset(CONTROL_KEY, 'paused', paused ? 'true' : 'false');
}

export async function setRunnerStatus(status: RunnerStatusState): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.hset(STATUS_KEY, {
    running: status.running ? 'true' : 'false',
    enabled: status.enabled ? 'true' : 'false',
    paused: status.paused ? 'true' : 'false',
    trafficMode: status.trafficMode,
    lifecycleIntervalSec: String(status.lifecycleIntervalSec),
    configVersion: String(status.configVersion),
    trafficRunId: status.trafficRunId ?? '',
    currentLifecycleId: status.currentLifecycleId ?? '',
    lastLifecycleStartedAt: status.lastLifecycleStartedAt ?? '',
    lastLifecycleCompletedAt: status.lastLifecycleCompletedAt ?? '',
    lifecycleStartedCount: String(status.lifecycleStartedCount),
    lifecycleCompletedCount: String(status.lifecycleCompletedCount),
    lifecycleNoopCount: String(status.lifecycleNoopCount),
    lifecycleFailedCount: String(status.lifecycleFailedCount),
    lifecycleInterruptedCount: String(status.lifecycleInterruptedCount),
    averageIntervalSec: status.averageIntervalSec === null ? '' : String(status.averageIntervalSec),
    paymentSuccessCount: String(status.paymentSuccessCount),
    cancelCount: String(status.cancelCount),
    couponRequestedCount: String(status.couponRequestedCount),
    couponAppliedCount: String(status.couponAppliedCount),
    addressCreatedCount: String(status.addressCreatedCount),
    cartReusedCount: String(status.cartReusedCount),
    pendingPaymentRetainedCount: String(status.pendingPaymentRetainedCount),
    updatedAt: status.updatedAt,
  });
  await redis.expire(STATUS_KEY, 30);
}

export async function getRunnerStatus(): Promise<RunnerStatusState | null> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const data = await redis.hgetall(STATUS_KEY);
  if (!data.updatedAt) {
    return null;
  }
  return {
    running: data.running === 'true',
    enabled: data.enabled !== 'false',
    paused: data.paused === 'true',
    trafficMode: 'CUSTOMER_LIFECYCLE',
    lifecycleIntervalSec: Number(data.lifecycleIntervalSec || 60),
    configVersion: Number(data.configVersion || 0),
    trafficRunId: data.trafficRunId || null,
    currentLifecycleId: data.currentLifecycleId || null,
    lastLifecycleStartedAt: data.lastLifecycleStartedAt || null,
    lastLifecycleCompletedAt: data.lastLifecycleCompletedAt || null,
    lifecycleStartedCount: Number(data.lifecycleStartedCount || 0),
    lifecycleCompletedCount: Number(data.lifecycleCompletedCount || 0),
    lifecycleNoopCount: Number(data.lifecycleNoopCount || 0),
    lifecycleFailedCount: Number(data.lifecycleFailedCount || 0),
    lifecycleInterruptedCount: Number(data.lifecycleInterruptedCount || 0),
    averageIntervalSec: data.averageIntervalSec ? Number(data.averageIntervalSec) : null,
    paymentSuccessCount: Number(data.paymentSuccessCount || 0),
    cancelCount: Number(data.cancelCount || 0),
    couponRequestedCount: Number(data.couponRequestedCount || 0),
    couponAppliedCount: Number(data.couponAppliedCount || 0),
    addressCreatedCount: Number(data.addressCreatedCount || 0),
    cartReusedCount: Number(data.cartReusedCount || 0),
    pendingPaymentRetainedCount: Number(data.pendingPaymentRetainedCount || 0),
    updatedAt: data.updatedAt,
  };
}

export interface InventoryReplenishmentStatusState {
  running: boolean;
  isExecuting: boolean;
  lastWindowId: string | null;
  lastResult: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  lastAttemptAt: string | null;
  lastCompletedAt: string | null;
  nextExecutionAt: string | null;
  retryCount: number;
  lastAddedQuantity: number;
  lastSkippedCount: number;
  lastFailedCount: number;
}

export async function setInventoryReplenishmentStatus(
  status: InventoryReplenishmentStatusState,
): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.set(INVENTORY_REPLENISHMENT_STATUS_KEY, JSON.stringify(status), 'EX', REPLENISHMENT_STATUS_TTL_SECONDS);
}

export async function getInventoryReplenishmentStatus(): Promise<InventoryReplenishmentStatusState | null> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const value = await redis.get(INVENTORY_REPLENISHMENT_STATUS_KEY);
  if (!value) return null;
  try {
    const status = JSON.parse(value) as InventoryReplenishmentStatusState;
    return {
      ...status,
      isExecuting: status.isExecuting ?? false,
      lastCompletedAt: status.lastCompletedAt ?? null,
    };
  } catch {
    return null;
  }
}

export interface CouponReplenishmentStatusState {
  running: boolean;
  isExecuting: boolean;
  lastWindowId: string | null;
  lastResult: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  lastAttemptAt: string | null;
  lastCompletedAt: string | null;
  nextExecutionAt: string | null;
  retryCount: number;
  lastAddedCount: number;
  lastSkippedCount: number;
  lastFailedCount: number;
}

export async function setCouponReplenishmentStatus(
  status: CouponReplenishmentStatusState,
): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.set(COUPON_REPLENISHMENT_STATUS_KEY, JSON.stringify(status), 'EX', REPLENISHMENT_STATUS_TTL_SECONDS);
}

export async function getCouponReplenishmentStatus(): Promise<CouponReplenishmentStatusState | null> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const value = await redis.get(COUPON_REPLENISHMENT_STATUS_KEY);
  if (!value) return null;
  try {
    const status = JSON.parse(value) as CouponReplenishmentStatusState;
    return {
      ...status,
      isExecuting: status.isExecuting ?? false,
      lastCompletedAt: status.lastCompletedAt ?? null,
      lastAddedCount: status.lastAddedCount ?? 0,
      lastSkippedCount: status.lastSkippedCount ?? 0,
      lastFailedCount: status.lastFailedCount ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Activity feed (written by worker, read by API route via Redis list) ──

export interface ActivityEntry {
  ts: number;
  action: string;
  success: boolean;
  latencyMs: number;
  trafficRunId?: string;
  customerId?: number;
  orderId?: string;
  paymentId?: string;
  traceId?: string;
  lifecycleId?: string;
  pendingPaymentRetained?: boolean;
  status?: 'SUCCESS' | 'FAILED' | 'NOOP' | 'INTERRUPTED';
  errorCode?: string;
}

const ACTIVITY_KEY = 'traffic-control-plane:runner:activity';
const ACTIVITY_MAX = 50;

export async function pushActivity(entry: ActivityEntry): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.lpush(ACTIVITY_KEY, JSON.stringify(entry));
  await redis.ltrim(ACTIVITY_KEY, 0, ACTIVITY_MAX - 1);
}

export async function getRunnerActivity(limit = 20): Promise<ActivityEntry[]> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const items = await redis.lrange(ACTIVITY_KEY, 0, limit - 1);
  return items.map((s) => JSON.parse(s) as ActivityEntry);
}

