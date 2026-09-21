import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayClient } from '../lib/gateway-client';
import type { LifecycleAccount } from '../lib/lifecycle-accounts';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import { FaultRunDrainRegistry } from './fault-run-drain-registry';
import { ReportScenarioFaultRunDriver, ReportScenarioWorker } from './report-scenario-worker';

const account: LifecycleAccount = {
  label: 'alice',
  email: 'alice@example.com',
  password: 'alice-password',
  expectedCustomerId: 2,
  enabled: true,
};

function createRun(scenario: FaultRunRecord['scenario']): FaultRunRecord {
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174077',
    scenario,
    targetService: 'catalog-service',
    targetOperation: 'report-operation',
    state: 'ACTIVE',
    parameters: { durationSec: 60 },
    idempotencyKey: 'report-gate-test-001',
    fencingToken: 1,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5_000).toISOString(),
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-report-gate',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

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
  assert.fail('Timed out waiting for report worker state');
}

test('report stop prevents an in-flight scanner query from admitting work', async () => {
  const runs = deferred<FaultRunRecord[]>();
  const registry = new FaultRunDrainRegistry();
  let accountLoads = 0;
  let events = 0;
  const worker = new ReportScenarioWorker({
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

  worker.start();
  await Promise.resolve();
  await worker.stop();
  runs.resolve([createRun('ORDER_REPORT_SQL')]);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));

  assert.equal(accountLoads, 0);
  assert.equal(events, 0);
});

test('report scanner rejects a closed safe-runtime gate before account setup or started events', async () => {
  const run = createRun('ORDER_REPORT_SQL');
  const registry = new FaultRunDrainRegistry();
  await registry.closeGate({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
  });
  let accountLoads = 0;
  let events = 0;
  const worker = new ReportScenarioWorker({
    gateway: {} as GatewayClient,
    listRunnableRuns: async () => [run],
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

  worker.start();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  await worker.stop();

  assert.equal(accountLoads, 0);
  assert.equal(events, 0);
});

test('report worker forwards its Run signal through login, request, and local session cleanup', async () => {
  const run = createRun('ORDER_REPORT_SQL');
  const registry = new FaultRunDrainRegistry();
  const signals: AbortSignal[] = [];
  const events: Array<{ type: string; payload?: unknown }> = [];
  const gateway = {
    async login(
      _email: string,
      _password: string,
      _traceId?: string,
      signal?: AbortSignal,
    ) {
      if (signal) signals.push(signal);
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
      _params: Record<string, string> | undefined,
      _context: unknown,
      signal?: AbortSignal,
    ) {
      if (signal) signals.push(signal);
      return new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Operation aborted', 'AbortError'));
        }, { once: true });
      });
    },
    async logout(_sessionToken: string, _traceId?: string, signal?: AbortSignal) {
      if (signal) signals.push(signal);
    },
  } as unknown as GatewayClient;
  const worker = new ReportScenarioWorker({
    gateway,
    listRunnableRuns: async () => [run],
    appendEvent: async (_faultRunId, type, payload) => {
      events.push({ type, payload });
    },
    loadAccounts: () => [account],
    drainRegistry: registry,
    safeRuntimeEnabled: true,
  });

  worker.start();
  await waitFor(() => signals.length >= 2);
  await registry.closeGate({
    run,
    owner: 'REPORT_SCENARIO_WORKER',
    deadlineAt: new Date(Date.now() + 1_000),
  });
  await waitFor(() => events.some((event) => event.type === 'REPORT_WORKER_STOPPED'));
  await worker.stop();

  assert.equal(signals.length, 3);
  assert.equal(signals.every((signal) => signal.aborted), true);
  assert.equal(events[0]?.type, 'REPORT_WORKER_STARTED');
  const stopped = events.find((event) => event.type === 'REPORT_WORKER_STOPPED');
  assert.deepEqual(stopped?.payload, {
    schemaVersion: 1,
    source: 'report-worker',
    phase: 'worker',
    status: 'COMPLETED',
    requests: 0,
    successes: 0,
    failures: 0,
    timeouts: 0,
    inFlight: 0,
    averageLatencyMs: 0,
    reason: 'RUN_STOPPED',
  });
});

test('report owned driver only supports report scenarios', () => {
  const driver = new ReportScenarioFaultRunDriver(new ReportScenarioWorker({
    gateway: {} as GatewayClient,
    listRunnableRuns: async () => [],
    appendEvent: async () => undefined,
    loadAccounts: () => [account],
    safeRuntimeEnabled: false,
  }));
  assert.equal(driver.supports(createRun('BROWSE_REPORT_SQL')), true);
  assert.equal(driver.supports(createRun('ORDER_REPORT_SQL')), true);
  assert.equal(driver.supports(createRun('BROWSE_SURGE')), false);
  const fence = new FaultRunOwnerFence(createRun('BROWSE_REPORT_SQL').faultRunId, 'worker-a', 1);
  assert.equal(fence.isLocallyCurrent(), true);
});
