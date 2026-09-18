import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getScenarioDefinition,
  listScenarioDefinitions,
} from './fault-run-catalog';
import {
  assertFaultRunRecoveryPolicy,
  FaultRunRecoveryPolicyInvariantError,
  resolveFaultRunRecoveryPolicy,
} from './fault-run-recovery-policy';

const EXPECTED_POLICIES = {
  BROWSE_REPORT_SQL: {
    workerDrain: { requirement: 'REQUIRED', owner: 'REPORT_SCENARIO_WORKER' },
    targetRelease: 'REQUIRED',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  ORDER_REPORT_SQL: {
    workerDrain: { requirement: 'REQUIRED', owner: 'REPORT_SCENARIO_WORKER' },
    targetRelease: 'REQUIRED',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  BROWSE_SURGE: {
    workerDrain: { requirement: 'REQUIRED', owner: 'TRAFFIC_SURGE_EXECUTOR' },
    targetRelease: 'NOT_APPLICABLE',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  ORDER_QUERY_SURGE: {
    workerDrain: { requirement: 'REQUIRED', owner: 'TRAFFIC_SURGE_EXECUTOR' },
    targetRelease: 'NOT_APPLICABLE',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  CATALOG_REDIS_LARGE_VALUE: {
    workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
    targetRelease: 'REQUIRED',
    cleanup: 'OPTIONAL_PER_RUN',
    verification: 'NOT_CONFIGURED',
  },
  CART_CATALOG_DEPENDENCY: {
    workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
    targetRelease: 'REQUIRED',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  NOTIFICATION_HEAP_PRESSURE: {
    workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
    targetRelease: 'FORBIDDEN',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  NOTIFICATION_STORAGE_APPEND: {
    workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
    targetRelease: 'REQUIRED',
    cleanup: 'OPERATOR_CONFIRMED',
    verification: 'NOT_CONFIGURED',
  },
  PROMOTION_LOCK_CONTENTION: {
    workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
    targetRelease: 'REQUIRED',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  INVENTORY_TABLE_EXCLUSIVE: {
    workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
    targetRelease: 'REQUIRED',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  INVENTORY_ROW_LOCK: {
    workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
    targetRelease: 'REQUIRED',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
  PSP_PROVIDER_OUTCOME: {
    workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
    targetRelease: 'REQUIRED',
    cleanup: 'NONE',
    verification: 'NOT_CONFIGURED',
  },
} as const;

test('catalog embeds the exact recovery policy for every fixed scenario', () => {
  const definitions = listScenarioDefinitions();
  assert.deepEqual(
    definitions.map((definition) => definition.scenario).sort(),
    Object.keys(EXPECTED_POLICIES).sort(),
  );

  for (const definition of definitions) {
    assert.deepEqual(definition.recoveryPolicy, EXPECTED_POLICIES[definition.scenario]);
    assert.equal(definition.recoveryPolicy.verification, 'NOT_CONFIGURED');
    assert.doesNotThrow(() => assertFaultRunRecoveryPolicy(definition));
  }
});

test('resolver derives immutable policy facts from one catalog definition', () => {
  const definition = getScenarioDefinition('NOTIFICATION_STORAGE_APPEND');
  const resolved = resolveFaultRunRecoveryPolicy(definition);

  assert.deepEqual(resolved, {
    recoveryStrategy: 'MANUAL_CLEANUP',
    workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
    targetRelease: 'REQUIRED',
    cleanup: 'OPERATOR_CONFIRMED',
    verification: 'NOT_CONFIGURED',
    target: {
      service: 'notification-service',
      operation: 'notification-storage',
    },
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.workerDrain), true);
  assert.equal(Object.isFrozen(resolved.target), true);
});

test('rejects invalid recovery policy combinations before an executor can consume them', () => {
  const report = getScenarioDefinition('ORDER_REPORT_SQL');
  const releaseForbiddenForReport = {
    ...report,
    recoveryPolicy: {
      ...report.recoveryPolicy,
      targetRelease: 'FORBIDDEN' as const,
    },
  };

  const storage = getScenarioDefinition('NOTIFICATION_STORAGE_APPEND');
  const automaticManualCleanup = {
    ...storage,
    recoveryPolicy: {
      ...storage.recoveryPolicy,
      cleanup: 'NONE' as const,
    },
  };

  const heap = getScenarioDefinition('NOTIFICATION_HEAP_PRESSURE');
  const releasingNonReleasingRun = {
    ...heap,
    recoveryPolicy: {
      ...heap.recoveryPolicy,
      targetRelease: 'REQUIRED' as const,
    },
  };

  for (const invalid of [
    releaseForbiddenForReport,
    automaticManualCleanup,
    releasingNonReleasingRun,
  ]) {
    assert.throws(
      () => assertFaultRunRecoveryPolicy(invalid),
      (error: unknown) => error instanceof FaultRunRecoveryPolicyInvariantError
        && error.code === 'INVALID_RECOVERY_POLICY',
    );
  }
});
