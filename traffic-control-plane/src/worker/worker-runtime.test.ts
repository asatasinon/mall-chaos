import assert from 'node:assert/strict';
import test from 'node:test';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import type { WorkerRuntimeDependencies } from './worker-runtime';
import { WorkerRuntime } from './worker-runtime';

const now = Date.parse('2026-09-18T10:00:00.000Z');

function createRun(overrides: Partial<FaultRunRecord> = {}): FaultRunRecord {
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174000',
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'storage-append',
    state: 'ACTIVE',
    parameters: { durationSec: 60 },
    idempotencyKey: 'worker-runtime-test-key',
    fencingToken: 1,
    startedAt: '2026-09-18T09:59:00.000Z',
    expiresAt: '2026-09-18T10:01:00.000Z',
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'worker-runtime-trace',
    createdAt: '2026-09-18T09:59:00.000Z',
    updatedAt: '2026-09-18T09:59:00.000Z',
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function createDependencies(
  calls: string[],
  overrides: Partial<WorkerRuntimeDependencies> = {},
): WorkerRuntimeDependencies {
  const component = (name: string) => ({
    start: async () => {
      calls.push(`${name}.start`);
    },
    stop: async () => {
      calls.push(`${name}.stop`);
    },
  });
  return {
    safeRuntimeEnabled: true,
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
    shutdownTimeoutMs: 90_000,
    internalServiceKey: 'internal-key',
    loadLifecycleAccounts: () => {
      calls.push('accounts.load');
      return [];
    },
    runner: {
      loadConfigFromDb: async () => {
        calls.push('runner.config');
      },
      start: () => {
        calls.push('runner.start');
      },
      stop: async () => {
        calls.push('runner.stop');
      },
    },
    recoveryExecutor: {
      start: async () => {
        calls.push('recovery.start');
      },
      scan: async () => {
        calls.push('recovery.scan');
      },
      stop: async () => {
        calls.push('recovery.stop');
        return { failedRunIds: [] };
      },
    },
    legacyRecovery: {
      scheduleActiveRuns: async () => {
        calls.push('legacy.schedule');
      },
      recoverExpiredRuns: async () => {
        calls.push('legacy.recover');
      },
    },
    couponScheduler: component('coupon'),
    inventoryScheduler: component('inventory'),
    reportWorker: {
      start: () => {
        calls.push('report.start');
      },
      stop: async () => {
        calls.push('report.stop');
      },
    },
    surgeExecutor: {
      start: () => {
        calls.push('surge.start');
      },
      stop: async () => {
        calls.push('surge.stop');
      },
    },
    scenarioWorkers: {
      start: () => {
        calls.push('scenario.start');
      },
      stop: async () => {
        calls.push('scenario.stop');
      },
    },
    dataWarmup: {
      start: () => {
        calls.push('warmup.start');
      },
      stop: async () => {
        calls.push('warmup.stop');
      },
    },
    listShutdownCandidates: async () => {
      calls.push('runs.list');
      return [createRun()];
    },
    requestStop: async () => {
      calls.push('runs.stop');
      return null;
    },
    runRetention: async () => {
      calls.push('retention.run');
    },
    closePool: async () => {
      calls.push('mysql.close');
    },
    closeRedis: async () => {
      calls.push('redis.close');
    },
    now: () => now,
    logger: {
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    } as unknown as WorkerRuntimeDependencies['logger'],
    ...overrides,
  };
}

test('starts recovery before effect scanners and tears down effect work before resources', async () => {
  const calls: string[] = [];
  const runtime = new WorkerRuntime(createDependencies(calls));

  await runtime.start();
  assert.ok(calls.indexOf('recovery.start') < calls.indexOf('report.start'));
  assert.ok(calls.indexOf('recovery.start') < calls.indexOf('surge.start'));
  assert.ok(calls.indexOf('recovery.start') < calls.indexOf('scenario.start'));
  assert.ok(calls.indexOf('recovery.start') < calls.indexOf('runner.start'));

  const exitCode = await runtime.shutdown('SIGTERM');

  assert.equal(exitCode, 0);
  assert.ok(calls.indexOf('report.stop') < calls.indexOf('runs.stop'));
  assert.ok(calls.indexOf('surge.stop') < calls.indexOf('runs.stop'));
  assert.ok(calls.indexOf('scenario.stop') < calls.indexOf('runs.stop'));
  assert.ok(calls.indexOf('runner.stop') < calls.indexOf('runs.stop'));
  assert.ok(calls.indexOf('runs.stop') < calls.indexOf('recovery.scan'));
  assert.ok(calls.indexOf('recovery.scan') < calls.indexOf('recovery.stop'));
  assert.ok(calls.indexOf('warmup.stop') < calls.indexOf('mysql.close'));
  assert.ok(calls.indexOf('mysql.close') < calls.indexOf('redis.close'));
});

test('fails closed before legacy scanners when reconciliation mode is non-OFF', async () => {
  const calls: string[] = [];
  let verified = false;
  const runtime = new WorkerRuntime(createDependencies(calls, {
    reconciliationMode: 'OBSERVE',
    verifyOwnershipSchema: async () => {
      verified = true;
    },
  }));

  await assert.rejects(
    () => runtime.start(),
    /FAULT_RUN_RECONCILER_NOT_CONFIGURED/,
  );
  assert.equal(verified, true);
  assert.equal(calls.includes('recovery.start'), false);
  assert.equal(calls.includes('report.start'), false);
});

test('runs Reconciler mode without starting legacy Fault Run scanners', async () => {
  const calls: string[] = [];
  let verified = false;
  const runtime = new WorkerRuntime(createDependencies(calls, {
    reconciliationMode: 'OBSERVE',
    verifyOwnershipSchema: async () => {
      verified = true;
    },
    reconciler: {
      start: async () => {
        calls.push('reconciler.start');
      },
      stop: async () => {
        calls.push('reconciler.stop');
      },
    },
  }));

  await runtime.start();
  assert.equal(verified, true);
  assert.equal(calls.includes('reconciler.start'), true);
  assert.equal(calls.includes('report.start'), false);
  assert.equal(calls.includes('surge.start'), false);
  assert.equal(calls.includes('scenario.start'), false);
  assert.equal(calls.includes('runner.start'), true);
  assert.equal(await runtime.shutdown('SIGTERM'), 0);
  assert.equal(calls.includes('reconciler.stop'), true);
});

test('coalesces shutdown requests and prevents later startup stages', async () => {
  const calls: string[] = [];
  const configuration = deferred();
  const dependencies = createDependencies(calls, {
    runner: {
      loadConfigFromDb: async () => {
        calls.push('runner.config');
        await configuration.promise;
      },
      start: () => {
        calls.push('runner.start');
      },
      stop: async () => {
        calls.push('runner.stop');
      },
    },
  });
  const runtime = new WorkerRuntime(dependencies);
  const starting = runtime.start();
  await Promise.resolve();

  const firstShutdown = runtime.shutdown('SIGINT');
  const secondShutdown = runtime.shutdown('SIGTERM');
  assert.equal(firstShutdown, secondShutdown);
  configuration.resolve();
  await starting;

  assert.equal(await firstShutdown, 0);
  assert.equal(calls.includes('recovery.start'), false);
  assert.equal(calls.includes('report.start'), false);
  assert.equal(calls.includes('runner.start'), false);
});

test('returns a non-zero shutdown outcome when recovery persistence cannot be confirmed', async () => {
  const calls: string[] = [];
  const runtime = new WorkerRuntime(createDependencies(calls, {
    requestStop: async () => {
      calls.push('runs.stop');
      throw new Error('RECOVERY_PERSISTENCE_UNCONFIRMED');
    },
  }));
  await runtime.start();

  assert.equal(await runtime.shutdown('SIGTERM'), 1);
  assert.equal(calls.includes('recovery.scan'), true);
  assert.equal(calls.includes('mysql.close'), true);
  assert.equal(calls.includes('redis.close'), true);
});

test('requests a Worker shutdown stop for a committed creating Run', async () => {
  const calls: string[] = [];
  const stops: Array<{ faultRunId: string; reason: string }> = [];
  const runtime = new WorkerRuntime(createDependencies(calls, {
    listShutdownCandidates: async () => [createRun({ state: 'CREATING' })],
    requestStop: async (input) => {
      stops.push({ faultRunId: input.faultRunId, reason: input.reason });
      return null;
    },
  }));
  await runtime.start();

  assert.equal(await runtime.shutdown('SIGTERM'), 0);
  assert.deepEqual(stops, [{
    faultRunId: createRun().faultRunId,
    reason: 'WORKER_SHUTDOWN',
  }]);
});

test('bounds a non-cooperative effect worker during shutdown', async () => {
  const calls: string[] = [];
  const runtime = new WorkerRuntime(createDependencies(calls, {
    shutdownTimeoutMs: 10,
    reportWorker: {
      start: () => {
        calls.push('report.start');
      },
      stop: async () => {
        calls.push('report.stop');
        await new Promise<void>(() => undefined);
      },
    },
  }));
  await runtime.start();

  assert.equal(await runtime.shutdown('SIGTERM'), 1);
  assert.equal(calls.includes('mysql.close'), true);
  assert.equal(calls.includes('redis.close'), true);
});
