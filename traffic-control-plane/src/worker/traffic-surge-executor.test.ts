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
    contractRevision: 'sc.v1:sha256:' + '0'.repeat(64),
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

function withConcurrency(
  run: FaultRunRecord,
  concurrency: number | string | undefined,
): FaultRunRecord {
  const parameters = { ...run.parameters };
  if (concurrency === undefined) delete parameters.concurrency;
  else parameters.concurrency = concurrency;
  return { ...run, parameters };
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

  assert.fail('Timed out waiting for surge worker state');
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

test('owned surge driver writes its declared terminal summary after drain', async () => {
  const run = {
    ...createRun('BROWSE_SURGE'),
    parameters: { durationSec: 60, concurrency: 1, requestIntervalMs: 60_000, pageSize: 20 },
  };
  const events: string[] = [];
  const gateway = {
    async get(): Promise<void> {},
  } as unknown as GatewayClient;
  const executor = new TrafficSurgeExecutor({
    gateway,
    listRunnableRuns: async () => [],
    appendEvent: async (_faultRunId, eventType) => { events.push(eventType); },
    loadAccounts: () => [account],
    drainRegistry: new FaultRunDrainRegistry(),
    safeRuntimeEnabled: true,
  });
  const driver = new TrafficSurgeFaultRunDriver(executor);
  const fence = new FaultRunOwnerFence(run.faultRunId, 'worker-a', 1);
  const handle = await driver.start({ run, fence });

  const result = await handle.stop({ reason: 'MANUAL', signal: fence.signal });

  assert.equal(result.drained, true);
  assert.ok(events.includes('SCENARIO_WORKER_STARTED'));
  assert.equal(events.at(-1), driver.summaryEventType);
  assert.equal(events.filter((eventType) => eventType === driver.summaryEventType).length, 1);
});

test('owned surge driver admits the catalog maximum concurrency', async () => {
  const run = withConcurrency(createRun('BROWSE_SURGE'), 128);
  run.parameters.requestIntervalMs = 60_000;
  let gatewayRequests = 0;
  const events: Array<{ type: string; payload?: unknown }> = [];
  const executor = new TrafficSurgeExecutor({
    gateway: {
      async get() {
        gatewayRequests++;
      },
    } as unknown as GatewayClient,
    listRunnableRuns: async () => [],
    appendEvent: async (_runId, type, payload) => {
      events.push({ type, payload });
    },
    drainRegistry: new FaultRunDrainRegistry(),
    safeRuntimeEnabled: false,
  });
  const fence = new FaultRunOwnerFence(run.faultRunId, 'worker-a', 1);
  const handle = await executor.startOwned(run, fence);

  await waitFor(() => gatewayRequests === 128);
  await handle.stop({ reason: 'MANUAL', signal: fence.signal });

  assert.equal(gatewayRequests, 128);
  assert.ok(events.some((event) => event.type === 'SCENARIO_WORKER_STARTED'
    && typeof event.payload === 'object'
    && event.payload !== null
    && 'concurrency' in event.payload
    && event.payload.concurrency === 128));
});

test('owned surge driver rejects invalid persisted concurrency before setup', async () => {
  const invalidValues: Array<number | string | undefined> = [129, 1.5, 0, '4', undefined];
  for (const [index, value] of invalidValues.entries()) {
    const run = {
      ...withConcurrency(createRun('ORDER_QUERY_SURGE'), value),
      faultRunId: `invalid-owned-surge-${index}`,
    };
    const events: Array<{ runId: string; type: string; payload?: unknown }> = [];
    let accountLoads = 0;
    let gatewayRequests = 0;
    const executor = new TrafficSurgeExecutor({
      gateway: {
        async login() {
          gatewayRequests++;
          throw new Error('SURGE_SETUP_MUST_NOT_START');
        },
        async customerGet() {
          gatewayRequests++;
        },
      } as unknown as GatewayClient,
      listRunnableRuns: async () => [],
      appendEvent: async (runId, type, payload) => {
        events.push({ runId, type, payload });
      },
      loadAccounts: () => {
        accountLoads++;
        return [account];
      },
      safeRuntimeEnabled: false,
    });

    await assert.rejects(
      () => executor.startOwned(run, new FaultRunOwnerFence(run.faultRunId, 'worker-a', 1)),
      (error: unknown) => error instanceof Error && error.message === 'INVALID_SURGE_CONCURRENCY',
    );

    assert.equal(accountLoads, 0);
    assert.equal(gatewayRequests, 0);
    assert.deepEqual(events, [{
      runId: run.faultRunId,
      type: 'SCENARIO_WORKER_SETUP_FAILED',
      payload: {
        schemaVersion: 1,
        source: 'scenario-worker',
        phase: 'worker',
        status: 'FAILED',
        failureCode: 'INVALID_SURGE_CONCURRENCY',
      },
    }]);
  }
});

test('legacy surge executor admits the catalog maximum concurrency', async () => {
  const run = withConcurrency(createRun('BROWSE_SURGE'), 128);
  run.parameters.requestIntervalMs = 60_000;
  let gatewayRequests = 0;
  const executor = new TrafficSurgeExecutor({
    gateway: {
      async get() {
        gatewayRequests++;
      },
    } as unknown as GatewayClient,
    listRunnableRuns: async () => [run],
    appendEvent: async () => undefined,
    loadAccounts: () => [account],
    safeRuntimeEnabled: false,
  });

  executor.start();
  await waitFor(() => gatewayRequests === 128);
  await executor.stop();

  assert.equal(gatewayRequests, 128);
});

test('legacy surge executor fails closed for invalid persisted concurrency', async () => {
  const invalidValues: Array<number | string | undefined> = [129, 1.5, 0, '4', undefined];
  const runs = invalidValues.map((value, index) => ({
    ...withConcurrency(createRun(index % 2 === 0 ? 'BROWSE_SURGE' : 'ORDER_QUERY_SURGE'), value),
    faultRunId: `invalid-legacy-surge-${index}`,
  }));
  const events: Array<{ runId: string; type: string; payload?: unknown }> = [];
  let accountLoads = 0;
  let gatewayRequests = 0;
  const executor = new TrafficSurgeExecutor({
    gateway: {
      async get() {
        gatewayRequests++;
      },
      async customerGet() {
        gatewayRequests++;
      },
      async login() {
        gatewayRequests++;
        throw new Error('SURGE_SETUP_MUST_NOT_START');
      },
    } as unknown as GatewayClient,
    listRunnableRuns: async () => runs,
    appendEvent: async (runId, type, payload) => {
      events.push({ runId, type, payload });
    },
    loadAccounts: () => {
      accountLoads++;
      return [account];
    },
    safeRuntimeEnabled: false,
  });

  executor.start();
  await waitFor(() => events.length === invalidValues.length);
  await executor.stop();

  assert.equal(accountLoads, 0);
  assert.equal(gatewayRequests, 0);
  assert.deepEqual(events.map(({ runId, type, payload }) => ({
    runId,
    type,
    payload,
  })), runs.map((run) => ({
    runId: run.faultRunId,
    type: 'SCENARIO_WORKER_SETUP_FAILED',
    payload: {
      schemaVersion: 1,
      source: 'scenario-worker',
      phase: 'worker',
      status: 'FAILED',
      failureCode: 'INVALID_SURGE_CONCURRENCY',
    },
  })));
});

test('legacy TrafficSurgeExecutor ignores recovering and terminal runs', async () => {
  let gatewayCalls = 0;
  let accountLoads = 0;
  let eventWrites = 0;
  const inactiveRuns = [
    { ...createRun('BROWSE_SURGE'), state: 'RECOVERING' as const },
    { ...createRun('ORDER_QUERY_SURGE'), state: 'STOPPED' as const },
  ];
  const executor = new TrafficSurgeExecutor({
    gateway: {
      async get() {
        gatewayCalls++;
      },
      async customerGet() {
        gatewayCalls++;
      },
    } as unknown as GatewayClient,
    listRunnableRuns: async () => inactiveRuns,
    appendEvent: async () => {
      eventWrites++;
    },
    loadAccounts: () => {
      accountLoads++;
      return [account];
    },
    safeRuntimeEnabled: false,
  });

  executor.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await executor.stop();

  assert.equal(gatewayCalls, 0);
  assert.equal(accountLoads, 0);
  assert.equal(eventWrites, 0);
});
