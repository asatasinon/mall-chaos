import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDataWarmupBootstrapConfig,
  validateDataWarmupConfigUpdate,
  validateDataWarmupEnabledUpdate,
  validateDataWarmupConfig,
  type DataWarmupConfigUpdate,
} from './data-warmup-config';

test('warmup bootstrap defaults satisfy the target invariant', () => {
  const config = getDataWarmupBootstrapConfig();
  assert.equal(config.windowDays * config.rowsPerDay, config.targetRows);
});

test('warmup configuration rejects a target that does not match the window', () => {
  assert.throws(
    () => validateDataWarmupConfig({
      enabled: true,
      windowDays: 180,
      rowsPerDay: 300_000,
      targetRows: 54_000_001,
      batchSize: 1_000,
      batchIntervalMs: 1_000,
      maxConcurrency: 2,
      dbConcurrency: 2,
    }),
    (error: unknown) => error instanceof Error
      && error.message === 'INVALID_DATA_WARMUP_CONFIGURATION',
  );
});

test('warmup configuration enforces bounded operational values', () => {
  assert.throws(
    () => validateDataWarmupConfig({
      enabled: true,
      windowDays: 366,
      rowsPerDay: 300_000,
      targetRows: 109_800_000,
      batchSize: 1_000,
      batchIntervalMs: 1_000,
      maxConcurrency: 2,
      dbConcurrency: 2,
    }),
    (error: unknown) => error instanceof Error
      && error.message === 'INVALID_DATA_WARMUP_CONFIGURATION',
  );
});

test('warmup enabled updates validate independently from operational settings', () => {
  assert.doesNotThrow(() => validateDataWarmupEnabledUpdate({ version: 3, enabled: false }));
  assert.throws(
    () => validateDataWarmupEnabledUpdate({ version: 0, enabled: false }),
    (error: unknown) => error instanceof Error
      && error.message === 'INVALID_DATA_WARMUP_CONFIGURATION',
  );
  assert.throws(
    () => validateDataWarmupEnabledUpdate({ version: 3, enabled: 'false' as unknown as boolean }),
    (error: unknown) => error instanceof Error
      && error.message === 'INVALID_DATA_WARMUP_CONFIGURATION',
  );
});

test('operational configuration updates reject the enabled field', () => {
  const current = {
    ...getDataWarmupBootstrapConfig(),
    version: 3,
    updatedByOperatorId: null,
    updatedAt: new Date().toISOString(),
  };
  assert.throws(
    () => validateDataWarmupConfigUpdate(
      { version: 3, enabled: true } as unknown as DataWarmupConfigUpdate,
      current,
    ),
    (error: unknown) => error instanceof Error
      && error.message === 'INVALID_DATA_WARMUP_CONFIGURATION',
  );
});
