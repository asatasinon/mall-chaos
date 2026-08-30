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

  async eval(_script: string, _numberOfKeys: number, key: string, token: string): Promise<number> {
    if (this.values.get(key) !== token) return 0;
    return this.del(key);
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function gatewayThat(
  implementation: (
    path: string,
    body: unknown,
    traceId?: string,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ) => Promise<unknown>,
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
    statusPublisher: async () => undefined,
    persistenceWriter: async () => undefined,
  };
}

test('inventory scheduler executes immediately and reports replenishment counts', async () => {
  const redis = new FakeRedis();
  let calls = 0;
  const scheduler = new InventoryReplenishmentScheduler(dependencies(
    gatewayThat(async (path, _body, _traceId, _signal, headers) => {
      calls++;
      assert.equal(path, '/internal/gateway/inventory/demo-stock/replenish');
      assert.match(headers?.['X-Replenishment-Run-Id'] ?? '', /^UTC-6H-/);
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
  assert.equal(status.isExecuting, false);
  assert.equal(status.lastCompletedAt, now.toISOString());
  assert.equal(status.lastAddedQuantity, 60);
  assert.equal(status.lastSkippedCount, 1);
  assert.equal(status.lastFailedCount, 0);
  assert.ok(status.nextExecutionAt);
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

  const status = await scheduler.executeScheduledWindow();

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

  const status = await scheduler.executeScheduledWindow();

  assert.equal(calls, 2);
  assert.deepEqual(paths, [
    '/internal/gateway/inventory/demo-stock/replenish',
    '/internal/gateway/inventory/demo-stock/replenish',
  ]);
  assert.equal(status.lastResult, 'COMPLETED');
  assert.equal(status.retryCount, 1);
  assert.equal(status.lastAddedQuantity, 10);
});

test('completed scheduled inventory window is idempotent', async () => {
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

  const status = await scheduler.executeScheduledWindow();

  assert.equal(calls, 0);
  assert.equal(status.lastResult, 'COMPLETED');
});

test('manual inventory execution is not skipped after a completed scheduled window', async () => {
  const redis = new FakeRedis();
  redis.seed(`traffic-control-plane:replenishment:inventory:completed:${windowId}`, 'completed');
  let calls = 0;
  const scheduledNextExecution = '2026-08-25T06:00:00.000Z';
  const scheduler = new InventoryReplenishmentScheduler({
    ...dependencies(
      gatewayThat(async (_path, _body, _traceId, _signal, headers) => {
        calls++;
        assert.match(headers?.['X-Replenishment-Run-Id'] ?? '', /^manual:/);
        return {
          code: 200,
          data: {
            code: 200,
            data: { addedQuantity: 10, skippedCount: 0, failedCount: 0 },
          },
        };
      }),
      redis,
    ),
    initialStatus: { running: true, nextExecutionAt: scheduledNextExecution },
  });

  const status = await scheduler.executeManual();

  assert.equal(calls, 1);
  assert.equal(status.lastResult, 'COMPLETED');
  assert.equal(status.running, true);
  assert.equal(status.nextExecutionAt, scheduledNextExecution);
});

test('inventory publishes running before its completed result', async () => {
  const redis = new FakeRedis();
  const publishedStatuses: Array<{ isExecuting: boolean; lastCompletedAt: string | null }> = [];
  const scheduler = new InventoryReplenishmentScheduler({
    ...dependencies(
      gatewayThat(async () => ({
        code: 200,
        data: { addedQuantity: 10, skippedCount: 0, failedCount: 0 },
      })),
      redis,
    ),
    statusPublisher: async (status) => {
      publishedStatuses.push(status);
    },
  });

  await scheduler.executeManual();

  assert.equal(publishedStatuses[0]?.isExecuting, true);
  assert.equal(publishedStatuses[publishedStatuses.length - 1]?.isExecuting, false);
  assert.equal(publishedStatuses[publishedStatuses.length - 1]?.lastCompletedAt, now.toISOString());
});

test('inventory treats a success response without replenishment data as a failure', async () => {
  const redis = new FakeRedis();
  let calls = 0;
  const scheduler = new InventoryReplenishmentScheduler(dependencies(
    gatewayThat(async () => {
      calls++;
      return { code: 200 };
    }),
    redis,
  ));

  const status = await scheduler.executeManual();

  assert.equal(calls, 3);
  assert.equal(status.lastResult, 'FAILED');
  assert.equal(status.isExecuting, false);
  assert.equal(status.lastCompletedAt, now.toISOString());
});

test('inventory execution does not release a lock acquired by another runner', async () => {
  const redis = new FakeRedis();
  const lockKey = 'traffic-control-plane:replenishment:inventory:lock';
  const scheduler = new InventoryReplenishmentScheduler(dependencies(
    gatewayThat(async () => {
      await redis.set(lockKey, 'successor');
      return { code: 200, data: { addedQuantity: 0, skippedCount: 1, failedCount: 0 } };
    }),
    redis,
  ));

  await scheduler.executeManual();

  assert.equal(await redis.get(lockKey), 'successor');
});
