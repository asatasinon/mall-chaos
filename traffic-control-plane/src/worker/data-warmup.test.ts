import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataWarmupConfig } from '../lib/data-warmup-config';
import {
  addDays,
  AsyncSemaphore,
  DataWarmupService,
  formatWarmupDate,
  parseWarmupDates,
} from './data-warmup';

const config: DataWarmupConfig = {
  enabled: true,
  windowDays: 1,
  rowsPerDay: 1,
  targetRows: 1,
  batchSize: 1,
  batchIntervalMs: 1_000,
  maxConcurrency: 1,
  dbConcurrency: 1,
  version: 1,
  updatedByOperatorId: null,
  updatedAt: '2026-09-18T10:00:00.000Z',
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
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for warmup lifecycle boundary');
}

test('adds calendar days without shifting Shanghai dates', () => {
  assert.equal(addDays('2026-08-28', 0), '2026-08-28');
  assert.equal(addDays('2026-08-28', 1), '2026-08-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('loads warmup dates from mysql JSON arrays and strings', () => {
  assert.deepEqual(parseWarmupDates(['2026-08-28']), ['2026-08-28']);
  assert.deepEqual(parseWarmupDates('["2026-08-28"]'), ['2026-08-28']);
});

test('formats mysql date values without shifting the application date', () => {
  assert.equal(formatWarmupDate(new Date('2026-03-06T16:00:00.000Z')), '2026-03-07');
  assert.equal(formatWarmupDate('2026-03-07'), '2026-03-07');
});

test('limits concurrent warmup operations', async () => {
  const semaphore = new AsyncSemaphore(2);
  let activeOperations = 0;
  let maxActiveOperations = 0;

  const results = await Promise.all(Array.from({ length: 6 }, (_, taskIndex) => semaphore.runExclusive(async () => {
    activeOperations += 1;
    maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    activeOperations -= 1;
    return taskIndex;
  })));

  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
  assert.equal(maxActiveOperations, 2);
});

test('stopping during configuration loading does not acquire a warmup lease', async () => {
  const loading = deferred<DataWarmupConfig>();
  let configLoads = 0;
  let progressInitializations = 0;
  let leaseAttempts = 0;
  const service = new DataWarmupService({
    loadConfig: async () => {
      configLoads += 1;
      return loading.promise;
    },
    ensureProgress: async () => {
      progressInitializations += 1;
    },
    acquireLease: async () => {
      leaseAttempts += 1;
      return true;
    },
  });

  service.start();
  await waitFor(() => configLoads === 1);
  const stopping = service.stop();
  loading.resolve(config);
  await stopping;

  assert.equal(progressInitializations, 0);
  assert.equal(leaseAttempts, 0);
});

test('lease release failures remain visible to the Worker shutdown coordinator', async () => {
  const renewalStarted = deferred<void>();
  const renewal = deferred<boolean>();
  let leaseAttempts = 0;
  let releaseAttempts = 0;
  const service = new DataWarmupService({
    loadConfig: async () => config,
    ensureProgress: async () => undefined,
    acquireLease: async () => {
      leaseAttempts += 1;
      return true;
    },
    renewLease: async () => {
      renewalStarted.resolve();
      return renewal.promise;
    },
    releaseLease: async () => {
      releaseAttempts += 1;
      throw new Error('Redis unavailable');
    },
  });

  service.start();
  await renewalStarted.promise;
  const stopping = service.stop();
  renewal.resolve(true);

  await assert.rejects(stopping, { message: 'DATA_WARMUP_LEASE_RELEASE_FAILED' });
  assert.equal(leaseAttempts, 1);
  assert.ok(releaseAttempts >= 1);
});