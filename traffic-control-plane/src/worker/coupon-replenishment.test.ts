import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayClient } from '../lib/gateway-client';
import type Redis from 'ioredis';
import { CouponReplenishmentScheduler } from './coupon-replenishment';

class FakeRedis {
  private readonly values = new Map<string, string>();
  private readonly lockedKeys = new Set<string>();

  async connect(): Promise<void> {}

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    if (args.includes('NX') && (this.lockedKeys.has(key) || this.values.has(key))) return null;
    this.values.set(key, value);
    if (args.includes('NX')) this.lockedKeys.add(key);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.values.delete(key);
    this.lockedKeys.delete(key);
    return 1;
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function gatewayThat(
  implementation: (path: string, body: unknown, traceId?: string) => Promise<unknown>,
): GatewayClient {
  return { postInternal: implementation } as unknown as GatewayClient;
}

function dependencies(
  gateway: GatewayClient,
  redis: FakeRedis,
  now = new Date('2026-08-25T01:00:00.000Z'),
) {
  return {
    gateway,
    redis: redis as unknown as Redis,
    now: () => now,
    sleep: async () => undefined,
  };
}

const TEST_WINDOW_ID = `UTC-6H-${Math.floor(
  new Date('2026-08-25T01:00:00.000Z').getTime() / 1000 / (6 * 60 * 60),
)}`;

test('scheduler executes the current window before the lifecycle starts', async () => {
  const redis = new FakeRedis();
  let calls = 0;
  const scheduler = new CouponReplenishmentScheduler(dependencies(
    gatewayThat(async () => {
      calls++;
      return { code: 200 };
    }),
    redis,
  ));

  await scheduler.start();
  const status = scheduler.getStatus();
  scheduler.stop();

  assert.equal(calls, 1);
  assert.equal(status.lastResult, 'COMPLETED');
  assert.equal(status.running, true);
  assert.match(status.lastWindowId ?? '', /^UTC-6H-/);
  assert.ok(status.nextExecutionAt);
});

test('lock contention skips a window without marking it completed', async () => {
  const redis = new FakeRedis();
  const scheduler = new CouponReplenishmentScheduler(dependencies(
    gatewayThat(async () => {
      throw new Error('gateway should not be called');
    }),
    redis,
  ));
  const originalSet = redis.set.bind(redis);
  redis.set = async (key, value, ...args) => {
    if (args.includes('NX')) return null;
    return originalSet(key, value, ...args);
  };

  const status = await scheduler.executeCurrentWindow();

  assert.equal(status.lastResult, 'SKIPPED');
  assert.equal(await redis.get(`traffic-control-plane:replenishment:coupon:completed:${TEST_WINDOW_ID}`), null);
});

test('gateway failures retry within the same window and complete once', async () => {
  const redis = new FakeRedis();
  let calls = 0;
  const scheduler = new CouponReplenishmentScheduler(dependencies(
    gatewayThat(async () => {
      calls++;
      if (calls < 3) throw new Error('temporary gateway failure');
      return { code: 200 };
    }),
    redis,
  ));

  const status = await scheduler.executeCurrentWindow();

  assert.equal(calls, 3);
  assert.equal(status.lastResult, 'COMPLETED');
  assert.equal(status.retryCount, 2);
  assert.equal(await redis.get(`traffic-control-plane:replenishment:coupon:completed:${TEST_WINDOW_ID}`), 'completed');
});

test('a completed window does not call Gateway again', async () => {
  const redis = new FakeRedis();
  redis.seed(`traffic-control-plane:replenishment:coupon:completed:${TEST_WINDOW_ID}`, 'completed');
  let calls = 0;
  const scheduler = new CouponReplenishmentScheduler(dependencies(
    gatewayThat(async () => {
      calls++;
      return { code: 200 };
    }),
    redis,
  ));

  const status = await scheduler.executeCurrentWindow();

  assert.equal(calls, 0);
  assert.equal(status.lastResult, 'COMPLETED');
});
