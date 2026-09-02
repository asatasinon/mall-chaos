import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getScenarioDefinition,
  listScenarioDefinitions,
  FaultRunValidationError,
  validateScenarioParameters,
} from './fault-run-catalog';

test('catalog exposes one fixed target for every scenario', () => {
  const definitions = listScenarioDefinitions();
  assert.equal(definitions.length, 11);
  assert.equal(new Set(definitions.map((definition) => definition.scenario)).size, definitions.length);
  assert.equal(getScenarioDefinition('CATALOG_REDIS_LARGE_VALUE').targetService, 'catalog-service');
  assert.equal(getScenarioDefinition('CATALOG_REDIS_LARGE_VALUE').targetOperation,
    'catalog-product-detail-large-value');
  assert.equal(getScenarioDefinition('INVENTORY_TABLE_EXCLUSIVE').targetOperation, 'inventory-availability-report');
});

test('catalog validates required duration and bounded optional parameters', () => {
  assert.deepEqual(
    validateScenarioParameters('BROWSE_SURGE', { durationSec: 30 }),
    { durationSec: 30, concurrency: 4, requestIntervalMs: 100, pageSize: 20 },
  );
  assert.deepEqual(
    validateScenarioParameters('BROWSE_SURGE', { durationSec: 30, concurrency: 4, requestIntervalMs: 100 }),
    { durationSec: 30, concurrency: 4, requestIntervalMs: 100, pageSize: 20 },
  );
  assert.throws(
    () => validateScenarioParameters('BROWSE_SURGE', { durationSec: 0 }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'INVALID_PARAMETER:durationSec',
  );
  assert.throws(
    () => validateScenarioParameters('BROWSE_SURGE', { durationSec: 30, targetService: 'order-service' }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'UNKNOWN_PARAMETER:targetService',
  );
});

test('catalog normalizes short and full byte units', () => {
  assert.deepEqual(
    validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 30, memberSizeBytes: '64kb',
    }),
    {
      durationSec: 30,
      concurrency: 4,
      requestIntervalMs: 100,
      memberCount: 8,
      memberSizeBytes: 64 * 1024,
      keyTtlSec: 900,
    },
  );
  assert.deepEqual(
    validateScenarioParameters('NOTIFICATION_STORAGE_APPEND', {
      durationSec: 30, totalBytes: '1g', appendBytes: '20k', minFreeBytes: '50mB',
    }),
    {
      durationSec: 30,
      requestIntervalMs: 100,
      totalBytes: 1024 ** 3,
      appendBytes: 20 * 1024,
      minFreeBytes: 50 * 1024 ** 2,
    },
  );
  assert.deepEqual(
    validateScenarioParameters('NOTIFICATION_STORAGE_APPEND', { durationSec: 30 }),
    {
      durationSec: 30,
      requestIntervalMs: 100,
      totalBytes: 1024 ** 2,
      appendBytes: 8 * 1024,
      minFreeBytes: 1024 ** 2,
    },
  );
});

test('catalog uses bounded JVM memory defaults', () => {
  assert.deepEqual(
    validateScenarioParameters('NOTIFICATION_HEAP_PRESSURE', { durationSec: 30 }),
    {
      durationSec: 30,
      requestIntervalMs: 100,
      retainedBytesPerNotification: 1024 ** 2,
    },
  );
  assert.deepEqual(
    validateScenarioParameters('NOTIFICATION_HEAP_PRESSURE', {
      durationSec: 30, retainedBytesPerNotification: '10M',
    }),
    {
      durationSec: 30,
      requestIntervalMs: 100,
      retainedBytesPerNotification: 10 * 1024 ** 2,
    },
  );
  assert.throws(
    () => validateScenarioParameters('NOTIFICATION_HEAP_PRESSURE', {
      durationSec: 30, retainedBytesPerNotification: '1023B',
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'INVALID_PARAMETER:retainedBytesPerNotification',
  );
  assert.throws(
    () => validateScenarioParameters('NOTIFICATION_HEAP_PRESSURE', {
      durationSec: 30, retainedBytesPerNotification: '10M+1',
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'INVALID_PARAMETER:retainedBytesPerNotification',
  );
});

test('catalog rejects unknown scenarios and duration above scenario limit', () => {
  assert.throws(
    () => getScenarioDefinition('unknown'),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'UNKNOWN_SCENARIO',
  );
  assert.throws(
    () => validateScenarioParameters('BROWSE_SURGE', { durationSec: 1801 }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'DURATION_EXCEEDS_SCENARIO_LIMIT',
  );
});

test('catalog enforces Hash member budget and a TTL that covers the run', () => {
  assert.throws(
    () => validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 600, memberCount: 47, memberSizeBytes: '2M', keyTtlSec: 900,
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'AGGREGATE_LOGICAL_BYTES_EXCEEDS_LIMIT',
  );
  assert.throws(
    () => validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 600, memberCount: 8, memberSizeBytes: '64K', keyTtlSec: 600,
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'KEY_TTL_TOO_SHORT',
  );
  assert.throws(
    () => validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 30, memberCount: 48, memberSizeBytes: '64K', keyTtlSec: 900,
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'INVALID_PARAMETER:memberCount',
  );
  assert.throws(
    () => validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 30, fieldCount: 8, memberSizeBytes: '64K', keyTtlSec: 900,
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'UNKNOWN_PARAMETER:fieldCount',
  );
});

test('catalog restricts PSP outcomes to the simulator contract', () => {
  assert.deepEqual(
    validateScenarioParameters('PSP_PROVIDER_OUTCOME', { durationSec: 600, providerOutcome: 'TIMEOUT' }),
    { durationSec: 600, providerOutcome: 'TIMEOUT', effectPercentage: 100 },
  );
  assert.deepEqual(
    validateScenarioParameters('PSP_PROVIDER_OUTCOME', {
      durationSec: 600, providerOutcome: 'TIMEOUT', effectPercentage: 40,
    }),
    { durationSec: 600, providerOutcome: 'TIMEOUT', effectPercentage: 40 },
  );
  assert.throws(
    () => validateScenarioParameters('PSP_PROVIDER_OUTCOME', { durationSec: 600, providerOutcome: 'APPROVED' }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'INVALID_PARAMETER:providerOutcome',
  );
});
