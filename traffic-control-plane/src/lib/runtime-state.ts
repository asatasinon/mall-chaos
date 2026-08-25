import { getRedis } from './redis';
import type { RunnerOrderRef } from './runner-persistence';

const CONTROL_KEY = 'traffic-control-plane:runner:control';
const STATUS_KEY = 'traffic-control-plane:runner:status';

export interface RunnerControlState {
  paused: boolean;
  rateMultiplier: number;
}

export interface RunnerStatusState {
  running: boolean;
  enabled: boolean;
  paused: boolean;
  currentQps: number;
  successRate: number;
  failRate: number;
  totalRequests: number;
  windowSeconds: number;
  rateMultiplier: number;
  configVersion: number;
  updatedAt: string;
}

export async function getRunnerControlState(): Promise<RunnerControlState> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const data = await redis.hgetall(CONTROL_KEY);
  return {
    paused: data.paused === 'true',
    rateMultiplier: data.rateMultiplier ? Number(data.rateMultiplier) : 1.0,
  };
}

export async function setRunnerPaused(paused: boolean): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.hset(CONTROL_KEY, 'paused', paused ? 'true' : 'false');
}

export async function setRunnerRateMultiplier(multiplier: number): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.hset(CONTROL_KEY, 'rateMultiplier', String(multiplier));
}

export async function setRunnerStatus(status: RunnerStatusState): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.hset(STATUS_KEY, {
    running: status.running ? 'true' : 'false',
    enabled: status.enabled ? 'true' : 'false',
    paused: status.paused ? 'true' : 'false',
    currentQps: String(status.currentQps),
    successRate: String(status.successRate),
    failRate: String(status.failRate),
    totalRequests: String(status.totalRequests),
    windowSeconds: String(status.windowSeconds),
    rateMultiplier: String(status.rateMultiplier),
    configVersion: String(status.configVersion),
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
    currentQps: Number(data.currentQps || 0),
    successRate: Number(data.successRate || 0),
    failRate: Number(data.failRate || 0),
    totalRequests: Number(data.totalRequests || 0),
    windowSeconds: Number(data.windowSeconds || 60),
    rateMultiplier: Number(data.rateMultiplier || 1),
    configVersion: Number(data.configVersion || 0),
    updatedAt: data.updatedAt,
  };
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
  status?: 'SUCCESS' | 'FAILED' | 'NOOP';
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

// ── Recent order IDs (used by CANCEL_ORDER action to cancel real orders) ──

const RECENT_ORDERS_KEY = 'traffic-control-plane:runner:recent-orders';
const RECENT_ORDERS_MAX = 100;

const PENDING_ORDERS_KEY = 'traffic-control-plane:runner:pending-orders';
const PAID_ORDERS_KEY = 'traffic-control-plane:runner:paid-orders';
const RUNNER_ORDERS_KEY = 'traffic-control-plane:runner:orders';
const ORDER_QUEUE_MAX = 100;

export async function pushRecentOrderId(orderId: string): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.lpush(RECENT_ORDERS_KEY, orderId);
  await redis.ltrim(RECENT_ORDERS_KEY, 0, RECENT_ORDERS_MAX - 1);
}

export async function popRecentOrderId(): Promise<string | null> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  return redis.rpop(RECENT_ORDERS_KEY);
}

export async function pushPendingOrder(order: RunnerOrderRef): Promise<void> {
  await pushOrder(PENDING_ORDERS_KEY, order);
}

export async function popPendingOrder(): Promise<RunnerOrderRef | null> {
  return popOrder(PENDING_ORDERS_KEY);
}

export async function pushPaidOrder(order: RunnerOrderRef): Promise<void> {
  await pushOrder(PAID_ORDERS_KEY, order);
}

export async function popPaidOrder(): Promise<RunnerOrderRef | null> {
  return popOrder(PAID_ORDERS_KEY);
}

export async function pushRunnerOrder(order: RunnerOrderRef): Promise<void> {
  await pushOrder(RUNNER_ORDERS_KEY, order);
}

export async function popRunnerOrder(): Promise<RunnerOrderRef | null> {
  return popOrder(RUNNER_ORDERS_KEY);
}

export async function clearRunnerOrderQueues(): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.del(RECENT_ORDERS_KEY, PENDING_ORDERS_KEY, PAID_ORDERS_KEY, RUNNER_ORDERS_KEY);
}

async function pushOrder(key: string, order: RunnerOrderRef): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.lpush(key, JSON.stringify(order));
  await redis.ltrim(key, 0, ORDER_QUEUE_MAX - 1);
}

async function popOrder(key: string): Promise<RunnerOrderRef | null> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const value = await redis.rpop(key);
  if (!value) return null;
  try {
    const order = JSON.parse(value) as Partial<RunnerOrderRef>;
    if (typeof order.customerId !== 'number' || typeof order.orderId !== 'string') return null;
    return order as RunnerOrderRef;
  } catch {
    return null;
  }
}
