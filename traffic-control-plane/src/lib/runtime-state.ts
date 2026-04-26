import { getRedis } from './redis';

const CONTROL_KEY = 'traffic-control-plane:runner:control';
const STATUS_KEY = 'traffic-control-plane:runner:status';
const POLICY_RELOAD_KEY = 'traffic-control-plane:inventory-reset:reload';
const TRIGGER_RESET_KEY = 'traffic-control-plane:inventory-reset:trigger';

export interface RunnerControlState {
  paused: boolean;
  rateMultiplier: number;
}

export interface RunnerStatusState {
  running: boolean;
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

export async function signalInventoryPolicyReload(): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.set(POLICY_RELOAD_KEY, String(Date.now()), 'EX', 60);
}

export async function consumeInventoryPolicyReload(): Promise<boolean> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const value = await redis.get(POLICY_RELOAD_KEY);
  if (!value) {
    return false;
  }
  await redis.del(POLICY_RELOAD_KEY);
  return true;
}

export async function signalInventoryResetTrigger(): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  await redis.set(TRIGGER_RESET_KEY, String(Date.now()), 'EX', 60);
}

export async function consumeInventoryResetTrigger(): Promise<boolean> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const value = await redis.get(TRIGGER_RESET_KEY);
  if (!value) {
    return false;
  }
  await redis.del(TRIGGER_RESET_KEY);
  return true;
}

// ── Activity feed (written by worker, read by API route via Redis list) ──

export interface ActivityEntry {
  ts: number;
  action: string;
  success: boolean;
  latencyMs: number;
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
