import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayClient } from '../lib/gateway-client';
import type { LifecycleAccount } from '../lib/lifecycle-accounts';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import { FaultRunDrainRegistry } from './fault-run-drain-registry';
import { TrafficSurgeExecutor, TrafficSurgeFaultRunDriver } from './traffic-surge-executor';

function createRun(scenario: FaultRunRecord['scenario']): FaultRunRecord {
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174078',
    scenario,
    targetService: 'catalog-service',
    targetOperation: 'browse-api-worker',
    state: 'ACTIVE',
    parameters: { durationSec: 60, concurrency: 1, requestIntervalMs: 0, pageSize: 20 },
    idempotencyKey: 'surge-gate-test-001',
    fencingToken: 1,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5_000).toISOString(),
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-surge-gate',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const account: LifecycleAccount = {
  label: 'alice',
  email: 'alice@example.com',
  password: 'alice-password',
  expectedCustomerId: 2,
  enabled: true,
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (assertion()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }

  test('surge owned driver only supports surge scenarios', () => {
    const driver = new TrafficSurgeFaultRunDriver(new TrafficSurgeExecutor({
      gateway: {} as GatewayClient,
      listRunnableRuns: async () => [],
      appendEvent: async () => undefined,
      loadAccounts: () => [account],
      safeRuntimeEnabled: false,
    }));
    assert.equal(driver.supports(createRun('BROWSE_SURGE')), true);
    assert.equal(driver.supports(createRun('ORDER_QUERY_SURGE')), true);
    assert.equal(driver.supports(createRun('BROWSE_REPORT_SQL')), false);
    assert.equal(new FaultRunOwnerFence(createRun('BROWSE_SURGE').faultRunId, 'worker-a', 1)
      .isLocallyCurrent(), true);
  });
  assert.fail('Timed out waiting for surge worker state');
}

test('surge stop prevents an in-flight scanner query from admitting work', async () => {
  const runs = deferred<FaultRunRecord[]>();
  const registry = new FaultRunDrainRegistry();
  let accountLoads = 0;
  let events = 0;
  const executor = new TrafficSurgeExecutor({
    gateway: {} as GatewayClient,
    listRunnableRuns: async () => runs.promise,
    appendEvent: async () => {
      events++;
    },
    loadAccounts: () => {
      accountLoads++;
      return [account];
    },
    drainRegistry: registry,
    safeRuntimeEnabled: true,
  });

  executor.start();
  await Promise.resolve();
  await executor.stop();
  runs.resolve([createRun('ORDER_QUERY_SURGE')]);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));

  assert.equal(accountLoads, 0);
  assert.equal(events, 0);
});

test('surge scanner rejects a closed safe-runtime gate before account setup or worker events', async () => {
  const run = createRun('ORDER_QUERY_SURGE');
  const registry = new FaultRunDrainRegistry();
  await registry.closeGate({
    run,
    owner: 'TRAFFIC_SURGE_EXECUTOR',
    deadlineAt: new Date(Date.now() + 1_000),
  });
  let accountLoads = 0;
  let events = 0;
  const executor = new TrafficSurgeExecutor({
    gateway: {} as GatewayClient,
    listRunnableRuns: async () => [run],
    appendEvent: async () => {
      events++;
    },
    loadAccounts: () => {
      accountLoads++;
      return [];
    },
    drainRegistry: registry,
    safeRuntimeEnabled: true,
  });

  executor.start();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  await executor.stop();

  assert.equal(accountLoads, 0);
  assert.equal(events, 0);
});

test('surge stop waits for the outer lifecycle cleanup after the worker request drains', async () => {
  const run = createRun('ORDER_QUERY_SURGE');
  const logout = deferred<void>();
  let requestStarted = false;
  let logoutStarted = false;
  const gateway = {
    async login() {
      return {
        userId: 2,
        accessToken: 'access-token',
        sessionToken: 'session-token',
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        roles: ['CUSTOMER'],
      };
    },
    async customerGet(
      _path: string,
      _params: Record<string, string>,
      _context: unknown,
      signal?: AbortSignal,
    ): Promise<void> {
      requestStarted = true;
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Operation aborted', 'AbortError'));
        }, { once: true });
      });
    },
    async logout(): Promise<void> {
      logoutStarted = true;
      return logout.promise;
    },
  } as unknown as GatewayClient;
  const executor = new TrafficSurgeExecutor({
    gateway,
    listRunnableRuns: async () => [run],
    appendEvent: async () => {},
    loadAccounts: () => [account],
    drainRegistry: new FaultRunDrainRegistry(),
    safeRuntimeEnabled: true,
  });

  executor.start();
  await waitFor(() => requestStarted);
  let stopFinished = false;
  const stopping = executor.stop().then(() => {
    stopFinished = true;
  });
  try {
    await waitFor(() => logoutStarted);
    assert.equal(stopFinished, false);
    logout.resolve();
    await stopping;
    assert.equal(stopFinished, true);
  } finally {
    logout.resolve();
    await stopping;
  }
});

test('surge worker aborts its admitted Gateway request when the Run gate closes', async () => {
  const run = createRun('BROWSE_SURGE');
  const registry = new FaultRunDrainRegistry();
  const signals: AbortSignal[] = [];
  const events: string[] = [];
  const gateway = {
    async get(
      _path: string,
      _params: Record<string, string>,
      options: { signal?: AbortSignal },
    ): Promise<void> {
      if (options.signal) signals.push(options.signal);
      return new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('Operation aborted', 'AbortError'));
        }, { once: true });
      });
    },
  } as unknown as GatewayClient;
  const executor = new TrafficSurgeExecutor({
    gateway,
    listRunnableRuns: async () => [run],
    appendEvent: async (_faultRunId, type) => {
      events.push(type);
    },
    drainRegistry: registry,
    safeRuntimeEnabled: true,
  });

  executor.start();
  try {
    await waitFor(() => signals.length === 1);
    await registry.closeGate({
      run,
      owner: 'TRAFFIC_SURGE_EXECUTOR',
      deadlineAt: new Date(Date.now() + 1_000),
    });
    await waitFor(() => events.includes('SCENARIO_WORKER_DRAINED'));

    assert.equal(signals[0]?.aborted, true);
    assert.deepEqual(events, [
      'SCENARIO_WORKER_STARTED',
      'SCENARIO_WORKER_STOPPED',
      'SCENARIO_WORKER_DRAINED',
    ]);
  } finally {
    await executor.stop();
  }
});
