import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFaultRunRuntimeConfig } from './env';

test('uses safe-runtime defaults without requiring Docker-specific grace configuration', () => {
  assert.deepEqual(parseFaultRunRuntimeConfig({}), {
    safeRuntimeEnabled: false,
    stopScanIntervalMs: 1000,
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
    shutdownTimeoutMs: 90_000,
    workerStopGracePeriodMs: null,
    reconciliationMode: 'OFF',
    ownerLeaseTtlMs: 30_000,
    ownerHeartbeatMs: 10_000,
    reconcileIntervalMs: 1000,
    ownerIdPrefix: 'traffic-control-plane-worker',
  });
});

test('rejects invalid safe-runtime runtime configuration', () => {
  assert.throws(
    () => parseFaultRunRuntimeConfig({ FAULT_RUN_SAFE_RUNTIME_ENABLED: 'yes' }),
    /INVALID_BOOLEAN_ENV:FAULT_RUN_SAFE_RUNTIME_ENABLED/,
  );
  assert.throws(
    () => parseFaultRunRuntimeConfig({ FAULT_RUN_STOP_SCAN_INTERVAL_MS: '1.5' }),
    /INVALID_INTEGER_ENV:FAULT_RUN_STOP_SCAN_INTERVAL_MS/,
  );
  assert.throws(
    () => parseFaultRunRuntimeConfig({
      FAULT_RUN_DRAIN_TIMEOUT_MS: '61000',
      FAULT_RUN_RECOVERY_TIMEOUT_MS: '60000',
    }),
    /INVALID_INTEGER_ENV:FAULT_RUN_RECOVERY_TIMEOUT_MS/,
  );
  assert.throws(
    () => parseFaultRunRuntimeConfig({
      FAULT_RUN_RECOVERY_TIMEOUT_MS: '91000',
      FAULT_RUN_SHUTDOWN_TIMEOUT_MS: '90000',
    }),
    /INVALID_INTEGER_ENV:FAULT_RUN_SHUTDOWN_TIMEOUT_MS/,
  );
});

test('requires the Compose Worker grace period to exceed its shutdown budget', () => {
  assert.throws(
    () => parseFaultRunRuntimeConfig({
      FAULT_RUN_WORKER_STOP_GRACE_PERIOD: '90s',
    }),
    /FAULT_RUN_WORKER_STOP_GRACE_PERIOD_TOO_SHORT/,
  );
  assert.throws(
    () => parseFaultRunRuntimeConfig({
      FAULT_RUN_WORKER_STOP_GRACE_PERIOD: '90',
    }),
    /INVALID_DURATION_ENV:FAULT_RUN_WORKER_STOP_GRACE_PERIOD/,
  );
  for (const invalidGracePeriod of ['2h', '1m30s', '16m']) {
    assert.throws(
      () => parseFaultRunRuntimeConfig({
        FAULT_RUN_WORKER_STOP_GRACE_PERIOD: invalidGracePeriod,
      }),
      /INVALID_DURATION_ENV:FAULT_RUN_WORKER_STOP_GRACE_PERIOD/,
    );
  }
  assert.deepEqual(parseFaultRunRuntimeConfig({
    FAULT_RUN_SAFE_RUNTIME_ENABLED: 'true',
    FAULT_RUN_DRAIN_TIMEOUT_MS: '30000',
    FAULT_RUN_RECOVERY_TIMEOUT_MS: '60000',
    FAULT_RUN_SHUTDOWN_TIMEOUT_MS: '90000',
    FAULT_RUN_STOP_SCAN_INTERVAL_MS: '1000',
    FAULT_RUN_WORKER_STOP_GRACE_PERIOD: '105s',
  }), {
    safeRuntimeEnabled: true,
    stopScanIntervalMs: 1000,
    drainTimeoutMs: 30_000,
    recoveryTimeoutMs: 60_000,
    shutdownTimeoutMs: 90_000,
    workerStopGracePeriodMs: 105_000,
    reconciliationMode: 'OFF',
    ownerLeaseTtlMs: 30_000,
    ownerHeartbeatMs: 10_000,
    reconcileIntervalMs: 1000,
    ownerIdPrefix: 'traffic-control-plane-worker',
  });
});

test('parses reconciliation mode and validates owner lease timing', () => {
  assert.equal(parseFaultRunRuntimeConfig({
    FAULT_RUN_RECONCILIATION_MODE: 'SHADOW',
    FAULT_RUN_OWNER_LEASE_TTL_MS: '30000',
    FAULT_RUN_OWNER_HEARTBEAT_MS: '10000',
    FAULT_RUN_RECONCILE_INTERVAL_MS: '500',
    FAULT_RUN_OWNER_ID_PREFIX: 'worker.release',
  }).reconciliationMode, 'SHADOW');
  assert.throws(
    () => parseFaultRunRuntimeConfig({
      FAULT_RUN_RECONCILIATION_MODE: 'READY',
    }),
    /INVALID_ENUM_ENV:FAULT_RUN_RECONCILIATION_MODE/,
  );
  assert.throws(
    () => parseFaultRunRuntimeConfig({
      FAULT_RUN_OWNER_LEASE_TTL_MS: '30000',
      FAULT_RUN_OWNER_HEARTBEAT_MS: '15000',
    }),
    /FAULT_RUN_OWNER_HEARTBEAT_TOO_LONG/,
  );
  assert.throws(
    () => parseFaultRunRuntimeConfig({
      FAULT_RUN_OWNER_ID_PREFIX: 'worker id with spaces',
    }),
    /INVALID_OWNER_ID_PREFIX/,
  );
});
