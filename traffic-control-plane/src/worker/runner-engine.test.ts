import assert from 'node:assert/strict';
import test from 'node:test';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import type { RunnerConfig } from '../lib/runner-config';
import type { RunnerActionResult, TrafficActionOrchestrator } from './traffic-action-orchestrator';
import { FaultRunDrainRegistry } from './fault-run-drain-registry';
import { RunnerEngine } from './runner-engine';

const now = Date.parse('2026-09-18T10:00:00.000Z');

const runnerConfig: RunnerConfig = {
  version: 1,
  enabled: true,
  trafficMode: 'CUSTOMER_LIFECYCLE',
  lifecycleIntervalSec: 60,
  maxItems: 3,
  maxItemQuantity: 3,
  successfulPaymentRatio: 1,
  couponUsageRatio: 0,
  backgroundActionsEnabled: false,
};

function createRun(overrides: Partial<FaultRunRecord> = {}): FaultRunRecord {
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174000',
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    targetService: 'notification-service',
    targetOperation: 'heap-retention',
    state: 'ACTIVE',
    parameters: { durationSec: 60 },
    idempotencyKey: 'runner-test-key',
    fencingToken: 1,
    startedAt: '2026-09-18T09:59:00.000Z',
    expiresAt: '2026-09-18T10:01:00.000Z',
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'runner-trace',
    createdAt: '2026-09-18T09:59:00.000Z',
    updatedAt: '2026-09-18T09:59:00.000Z',
    ...overrides,
  };
}

function result(overrides: Partial<RunnerActionResult> = {}): RunnerActionResult {
  return {
    actionId: 'action-1',
    lifecycleId: 'lifecycle-1',
    customerId: 1,
    traceId: 'trace-1',
    success: true,
    status: 'SUCCESS',
    ...overrides,
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
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for runner lifecycle');
}

interface Harness {
  engine: RunnerEngine;
  registry: FaultRunDrainRegistry;
  setRun: (run: FaultRunRecord | null) => void;
  setRunLoader: (loader: () => Promise<FaultRunRecord | null>) => void;
  lifecycleOptions: Array<{ signal?: AbortSignal; faultRunId?: string }>;
  storageOptions: Array<{ signal?: AbortSignal; faultRunId: string }>;
  events: string[];
}

function createHarness(
  executeLifecycle: Pick<TrafficActionOrchestrator, 'executeLifecycle'>['executeLifecycle']
    = async () => result(),
  executeStorageGrowth: Pick<TrafficActionOrchestrator, 'executeStorageGrowth'>['executeStorageGrowth']
    = async () => result({ resultCode: 'STORAGE_APPEND_COMPLETE' }),
): Harness {
  let loadedRun: FaultRunRecord | null = null;
  let runLoader = async (): Promise<FaultRunRecord | null> => loadedRun;
  const registry = new FaultRunDrainRegistry();
  const lifecycleOptions: Harness['lifecycleOptions'] = [];
  const storageOptions: Harness['storageOptions'] = [];
  const events: string[] = [];
  const orchestrator: Pick<TrafficActionOrchestrator, 'executeLifecycle' | 'executeStorageGrowth'> = {
    executeLifecycle: async (trafficRunId, config, options = {}) => {
      lifecycleOptions.push({
        signal: options.signal,
        faultRunId: options.faultRunContext?.faultRunId,
      });
      return executeLifecycle(trafficRunId, config, options);
    },
    executeStorageGrowth: async (trafficRunId, faultRunContext, options) => {
      storageOptions.push({ signal: options.signal, faultRunId: faultRunContext.faultRunId });
      return executeStorageGrowth(trafficRunId, faultRunContext, options);
    },
  };
  const engine = new RunnerEngine({
    loadConfig: async () => runnerConfig,
    ensureTrafficRun: async () => undefined,
    completeTrafficRun: async () => undefined,
    loadRunnableFaultRun: async () => runLoader(),
    appendEvent: async (_faultRunId, eventType) => {
      events.push(eventType);
    },
    markServiceUnavailable: async () => undefined,
    getControlState: async () => ({ paused: false }),
    activityWriter: async () => undefined,
    statusWriter: async () => undefined,
    orchestrator,
    drainRegistry: registry,
    safeRuntimeEnabled: true,
    now: () => now,
    createTrafficRunId: () => 'traffic-run-1',
  });
  return {
    engine,
    registry,
    setRun: (run) => {
      loadedRun = run;
    },
    setRunLoader: (loader) => {
      runLoader = loader;
    },
    lifecycleOptions,
    storageOptions,
    events,
  };
}

test('runner only attaches a controlled context to a future ACTIVE Runner scenario', async () => {
  const harness = createHarness();
  harness.engine.start();
  try {
    for (const run of [
      createRun({ state: 'CREATING' }),
      createRun({ state: 'RECOVERING' }),
      createRun({ expiresAt: '2026-09-18T09:59:59.000Z' }),
      createRun({ scenario: 'BROWSE_REPORT_SQL', targetService: 'catalog-service' }),
    ]) {
      harness.setRun(run);
      await harness.engine.tick();
    }

    assert.equal(harness.lifecycleOptions.length, 4);
    assert.deepEqual(
      harness.lifecycleOptions.map((options) => options.faultRunId),
      [undefined, undefined, undefined, undefined],
    );

    const activeRunnerRun = createRun({ scenario: 'PSP_PROVIDER_OUTCOME' });
    harness.setRun(activeRunnerRun);
    await harness.engine.tick();

    assert.equal(harness.lifecycleOptions.at(-1)?.faultRunId, activeRunnerRun.faultRunId);
    assert.deepEqual(harness.events, ['RUNNER_LIFECYCLE_SUMMARY']);
  } finally {
    await harness.engine.stop();
  }
});

test('runner refuses a closed local gate before starting controlled work', async () => {
  const harness = createHarness();
  const run = createRun({ scenario: 'NOTIFICATION_STORAGE_APPEND' });
  harness.setRun(run);
  await harness.registry.closeGate({
    run,
    owner: 'RUNNER_ENGINE',
    deadlineAt: new Date(now + 1_000),
  });

  harness.engine.start();
  try {
    await harness.engine.tick();

    assert.equal(harness.lifecycleOptions.length, 0);
    assert.equal(harness.storageOptions.length, 0);
    assert.deepEqual(harness.events, []);
    assert.equal(harness.engine.getStatus().lifecycleStartedCount, 0);
  } finally {
    await harness.engine.stop();
  }
});

test('runner gate closure aborts only the admitted controlled lifecycle and allows later normal work', async () => {
  const controlledResult = deferred<RunnerActionResult>();
  const harness = createHarness(async () => controlledResult.promise);
  const run = createRun();
  harness.setRun(run);
  harness.engine.start();
  try {
    const tick = harness.engine.tick();
    await waitFor(() => harness.lifecycleOptions.length === 1);

    const signal = harness.lifecycleOptions[0]?.signal;
    assert.ok(signal);
    assert.equal(signal.aborted, false);
    await harness.registry.closeGate({
      run,
      owner: 'RUNNER_ENGINE',
      deadlineAt: new Date(now + 1_000),
    });

    test('runner stop waits for an in-flight tick and prevents post-stop lifecycle admission', async () => {
      const loaded = deferred<FaultRunRecord | null>();
      const harness = createHarness();
      let loadStarted = false;
      harness.setRunLoader(async () => {
        loadStarted = true;
        return loaded.promise;
      });
      harness.engine.start();
      const tick = harness.engine.tick();
      try {
        await waitFor(() => loadStarted);
        let stopped = false;
        const stopping = harness.engine.stop().then(() => {
          stopped = true;
        });
        await Promise.resolve();
        assert.equal(stopped, false);

        loaded.resolve(createRun());
        await Promise.all([tick, stopping]);
        assert.equal(harness.lifecycleOptions.length, 0);
        assert.equal(harness.storageOptions.length, 0);
      } finally {
        await harness.engine.stop();
      }
    });
    assert.equal(signal.aborted, true);
    assert.equal(harness.engine.getStatus().running, true);

    controlledResult.resolve(result({
      success: false,
      status: 'INTERRUPTED',
      errorCode: 'LIFECYCLE_INTERRUPTED',
    }));
    await tick;

    harness.setRun(null);
    await harness.engine.tick();
    assert.equal(harness.lifecycleOptions.length, 2);
    assert.equal(harness.lifecycleOptions[1]?.faultRunId, undefined);

    const drain = await harness.registry.drain({
      run,
      owner: 'RUNNER_ENGINE',
      deadlineAt: new Date(now + 1_000),
      signal: new AbortController().signal,
    });
    assert.equal(drain.kind, 'DRAINED');
  } finally {
    await harness.engine.stop();
  }
});
