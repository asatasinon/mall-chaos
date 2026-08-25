import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayClient } from '../lib/gateway-client';
import type Redis from 'ioredis';
import { InventoryReplenishmentScheduler } from './inventory-replenishment';

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

const now = new Date('2026-08-25T01:00:00.000Z');
const windowId = `UTC-6H-${Math.floor(now.getTime() / 1000 / (6 * 60 * 60))}`;

function dependencies(gateway: GatewayClient, redis: FakeRedis) {
  return {
    gateway,
    redis: redis as unknown as Redis,
    now: () => now,
    sleep: async () => undefined,
  };
}

test('inventory scheduler executes immediately and reports replenishment counts', async () => {
  const redis = new FakeRedis();
  let calls = 0;
  const scheduler = new InventoryReplenishmentScheduler(dependencies(
    gatewayThat(async (path) => {
      calls++;
      assert.equal(path, '/internal/gateway/inventory/demo-stock/replenish');
      return { code: 200, data: { addedQuantity: 60, skippedCount: 1, failedCount: 0 } };
    }),
    redis,
  ));

  await scheduler.start();
  const status = scheduler.getStatus();
  scheduler.stop();

  assert.equal(calls, 1);
  assert.equal(status.running, true);
  assert.equal(status.lastResult, 'COMPLETED');
  assert.equal(status.lastAddedQuantity, 60);
  assert.equal(status.lastSkippedCount, 1);
  assert.equal(status.lastFailedCount, 0);
  assert.equal(status.nextExecutionAt, null);
});

test('inventory lock contention skips without completing the window', async () => {
  const redis = new FakeRedis();
  redis.set = async (_key, _value, ...args) => args.includes('NX') ? null : 'OK';
  let calls = 0;
  const scheduler = new InventoryReplenishmentScheduler(dependencies(
    gatewayThat(async () => {
      calls++;
      return { code: 200 };
    }),
    redis,
  ));

  const status = await scheduler.executeCurrentWindow();

  assert.equal(calls, 0);
  assert.equal(status.lastResult, 'SKIPPED');
  assert.equal(await redis.get(`traffic-control-plane:replenishment:inventory:completed:${windowId}`), null);
});

test('inventory Gateway failures retry and never call reset routes', async () => {
  const redis = new FakeRedis();
  let calls = 0;
  const paths: string[] = [];
  const scheduler = new InventoryReplenishmentScheduler(dependencies(
    gatewayThat(async (path) => {
      calls++;
      paths.push(path);
      if (calls === 1) throw new Error('temporary failure');
      return { code: 200, data: { addedQuantity: 10, skippedCount: 0, failedCount: 0 } };
    }),
    redis,
  ));

  const status = await scheduler.executeCurrentWindow();

  assert.equal(calls, 2);
  assert.deepEqual(paths, [
    '/internal/gateway/inventory/demo-stock/replenish',
    '/internal/gateway/inventory/demo-stock/replenish',
  ]);
  assert.equal(status.lastResult, 'COMPLETED');
  assert.equal(status.retryCount, 1);
  assert.equal(status.lastAddedQuantity, 10);
});

test('completed inventory window is idempotent', async () => {
  const redis = new FakeRedis();
  redis.seed(`traffic-control-plane:replenishment:inventory:completed:${windowId}`, 'completed');
  let calls = 0;
  const scheduler = new InventoryReplenishmentScheduler(dependencies(
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
