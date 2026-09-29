import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getScenarioDefinition,
  listScenarioDefinitions,
  FaultRunValidationError,
  validateScenarioParameters,
} from './fault-run-catalog';
import { SAFE_RUNTIME_RECOVERY_EVENT_TYPES } from './fault-run-event-contract';
import { getScenarioContractRevision, resolveScenarioContract } from './scenario-contract';

test('catalog exposes one fixed target for every scenario', () => {
  const definitions = listScenarioDefinitions();
  assert.equal(definitions.length, 12);
  assert.equal(new Set(definitions.map((definition) => definition.scenario)).size, definitions.length);
  assert.equal(getScenarioDefinition('CATALOG_REDIS_LARGE_VALUE').targetService, 'catalog-service');
  assert.equal(getScenarioDefinition('CATALOG_REDIS_LARGE_VALUE').targetOperation,
    'product-detail-cache');
  assert.equal(getScenarioDefinition('BROWSE_SURGE').targetService, 'catalog-service');
  assert.equal(getScenarioDefinition('ORDER_QUERY_SURGE').targetService, 'order-service');
  assert.equal(getScenarioDefinition('INVENTORY_TABLE_EXCLUSIVE').targetOperation, 'inventory-availability-report');
  assert.equal(getScenarioDefinition('INVENTORY_ROW_LOCK').targetOperation, 'inventory-reservation-summary');
});

test('catalog provides a complete resolved Scenario Contract for every scenario', () => {
  const definitions = listScenarioDefinitions();
  const contractRevisions = new Set<string>();

  assert.equal(definitions.length, 12);
  for (const definition of definitions) {
    const parameterNames = definition.parameters.map(({ name }) => name).sort();
    const consumerNames = Object.keys(definition.contract.parameterConsumers).sort();
    const resolved = resolveScenarioContract(definition);
    const recipesById = new Map(definition.contract.evidence.recipes.map((recipe) => [recipe.id, recipe]));
    const recipeIds = new Set(recipesById.keys());

    assert.deepEqual(consumerNames, parameterNames);
    assert.ok(definition.contract.parameterConsumers.durationSec?.includes('ADMISSION'));
    assert.ok(Object.values(definition.contract.parameterConsumers)
      .every((consumers) => consumers.length > 0 && consumers.includes('ADMISSION')));
    assert.ok(definition.contract.lifecycle.prepareEventTypes.every((eventType) => (
      ['CREATED', 'TARGET_CONFIRMED', 'CREATE_FAILED'].includes(eventType)
    )));
    assert.ok(definition.contract.lifecycle.stopEventTypes.every((eventType) => (
      SAFE_RUNTIME_RECOVERY_EVENT_TYPES.includes(eventType)
    )));
    assert.deepEqual(
      definition.contract.lifecycle.prepareEventTypes,
      definition.targetPrepare === 'REQUIRED'
        ? ['CREATED', 'TARGET_CONFIRMED', 'CREATE_FAILED']
        : ['CREATED'],
    );
    assert.ok(definition.contract.lifecycle.stopEventTypes.includes('STOP_REQUESTED'));
    assert.ok(definition.contract.lifecycle.stopEventTypes.includes('DRAIN_COMPLETED'));
    assert.ok(definition.contract.lifecycle.stopEventTypes.includes('DRAIN_LATE_COMPLETED'));
    assert.ok(definition.contract.lifecycle.stopEventTypes.includes('VERIFY_STARTED'));
    assert.ok(definition.contract.lifecycle.stopEventTypes.includes('RECOVERY_COMPLETED'));
    assert.ok(!definition.contract.lifecycle.stopEventTypes.includes('RECOVERY_PARTIAL'));
    assert.ok(definition.contract.lifecycle.stopEventTypes.includes('CLEANUP_SKIPPED'));
    if (definition.recoveryStrategy === 'NON_RELEASING') {
      assert.ok(definition.contract.lifecycle.stopEventTypes.includes('NON_RELEASING_RECORDED'));
      assert.ok(!definition.contract.lifecycle.stopEventTypes.includes('RELEASE_SKIPPED'));
    } else {
      assert.ok(definition.contract.lifecycle.stopEventTypes.includes(
        definition.recoveryPolicy.targetRelease === 'REQUIRED' ? 'RELEASE_COMPLETED' : 'RELEASE_SKIPPED',
      ));
    }
    assert.deepEqual(
      definition.contract.lifecycle.cleanupActionTypes,
      definition.recoveryPolicy.cleanup === 'NONE' ? [] : ['CLEANUP'],
    );
    assert.equal(recipeIds.size, definition.contract.evidence.recipes.length);
    assert.ok(definition.contract.evidence.effectRule.recipeIds.length > 0);
    assert.ok(definition.contract.evidence.effectRule.recipeIds.every((id) => recipeIds.has(id)));
    assert.deepEqual(
      ['RUN_EVENT', 'PROMETHEUS', 'LOKI', 'TEMPO'].map((source) => (
        definition.contract.evidence.recipes.some((recipe) => recipe.source === source)
      )),
      [true, true, true, true],
    );
    assert.ok(definition.contract.evidence.recipes
      .filter(({ observationMode }) => observationMode === 'CURRENT')
      .every(({ id }) => !definition.contract.evidence.effectRule.recipeIds.includes(id)));
    assert.ok(definition.contract.lifecycle.recoveryRecipeIds.length > 0);
    assert.ok(definition.contract.lifecycle.recoveryRecipeIds.every((id) => recipeIds.has(id)));
    assert.ok(definition.contract.lifecycle.sideEffectRecipeIds.every((id) => recipeIds.has(id)));
    assert.ok(definition.contract.lifecycle.recoveryRecipeIds.every((id) => (
      recipesById.get(id)?.window === 'recovery'
        && recipesById.get(id)?.observationMode === 'WINDOWED'
    )));
    assert.ok(definition.contract.lifecycle.sideEffectRecipeIds.every((id) => (
      recipesById.get(id)?.window === 'active'
        && definition.contract.evidence.effectRule.recipeIds.includes(id)
    )));
    assert.equal(definition.contract.alert.receiptPolicyId, 'alert-receipt.v1');
    if ('allowedAlerts' in definition.contract.alert) {
      assert.ok(definition.contract.alert.allowedAlerts.length > 0);
      for (const alert of definition.contract.alert.allowedAlerts) {
        assert.equal(alert.correlationWindowSec, 900);
        assert.equal(alert.activeGraceBeforeSec, 900);
        assert.equal(alert.recentGraceAfterSec, 900);
        assert.equal(alert.sendResolvedToControlPlane, true);
      }
    }
    assert.equal(
      definition.contract.lifecycle.cleanupActionTypes.length > 0,
      definition.recoveryPolicy.cleanup !== 'NONE',
    );
    if (definition.recoveryPolicy.cleanup !== 'NONE') {
      assert.ok(definition.contract.evidence.recipes.some((recipe) => (
        recipe.window === 'cleanup' && recipe.source === 'RUN_EVENT'
      )));
    }
    if (definition.recoveryStrategy === 'NON_RELEASING') {
      assert.ok(definition.contract.lifecycle.nonReleasingReason);
      assert.ok(definition.contract.budgets.some(({ boundary }) => (
        boundary.kind === 'APPROVED_NON_RELEASING_EXCEPTION'
      )));
    }
    assert.match(getScenarioContractRevision(resolved), /^sc\.v1:sha256:[a-f0-9]{64}$/);
    contractRevisions.add(getScenarioContractRevision(resolved));
  }

  assert.equal(contractRevisions.size, definitions.length);
  assert.equal(
    getScenarioDefinition('BROWSE_SURGE').parameters.find(({ name }) => name === 'concurrency')?.max,
    128,
  );
  assert.equal(
    getScenarioDefinition('ORDER_QUERY_SURGE').parameters.find(({ name }) => name === 'concurrency')?.max,
    128,
  );
  assert.deepEqual(
    getScenarioDefinition('BROWSE_SURGE').contract.parameterConsumers.concurrency,
    ['ADMISSION', 'WORKER_EXECUTION'],
  );
  assert.ok(getScenarioDefinition('NOTIFICATION_STORAGE_APPEND')
    .contract.parameterConsumers.totalBytes.includes('TARGET_PREPARE'));
  assert.ok(getScenarioDefinition('NOTIFICATION_STORAGE_APPEND')
    .contract.parameterConsumers.totalBytes.includes('WORKER_EXECUTION'));
  assert.equal(
    getScenarioDefinition('NOTIFICATION_STORAGE_APPEND').parameters.find(({ name }) => name === 'minFreeBytes')?.min,
    1024 ** 2,
  );
  assert.equal(
    getScenarioDefinition('NOTIFICATION_STORAGE_APPEND').parameters.find(({ name }) => name === 'totalBytes')?.max,
    undefined,
  );
  assert.ok(getScenarioDefinition('CATALOG_REDIS_LARGE_VALUE').contract.budgets.some(({ boundary }) => (
    boundary.kind === 'CATALOG_RULE'
      && boundary.ruleId === 'CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES'
      && boundary.parameterNames.includes('memberSizeBytes')
  )));
  assert.ok(getScenarioDefinition('NOTIFICATION_STORAGE_APPEND').contract.budgets.some(({ boundary }) => (
    boundary.kind === 'TARGET_CAPACITY_GUARD'
      && boundary.guardId === 'FILESYSTEM_USABLE_SPACE_RESERVE'
      && boundary.targetBytesParameter === 'totalBytes'
      && boundary.reserveBytesParameter === 'minFreeBytes'
  )));
  const storageContract = getScenarioDefinition('NOTIFICATION_STORAGE_APPEND').contract;
  const storageEffectTemplates = storageContract.evidence.recipes
    .filter(({ id }) => storageContract.evidence.effectRule.recipeIds.includes(id))
    .map(({ template }) => template);
  assert.ok(storageEffectTemplates.includes('NODE_FILESYSTEM_GROWTH_RATE'));
  assert.deepEqual(
    storageContract.evidence.recipes.find(({ template }) => template === 'NODE_FILESYSTEM_GROWTH_RATE')?.predicate,
    { kind: 'COMPARISON', operator: 'LT', value: -(2 * 1024 ** 2) },
  );
  const paymentContract = getScenarioDefinition('PSP_PROVIDER_OUTCOME').contract;
  const paymentEffectTemplates = paymentContract.evidence.recipes
    .filter(({ id }) => paymentContract.evidence.effectRule.recipeIds.includes(id))
    .map(({ template }) => template);
  assert.ok(paymentEffectTemplates.includes('PAYMENT_FAILURE_RATIO'));
  assert.ok(paymentEffectTemplates.includes('PAYMENT_TIMEOUT_RATE'));
  assert.deepEqual(
    paymentContract.evidence.recipes.find(({ template }) => template === 'PAYMENT_FAILURE_RATIO')?.predicate,
    { kind: 'COMPARISON', operator: 'GT', value: 0.1 },
  );
  assert.deepEqual(
    paymentContract.evidence.recipes.find(({ template }) => template === 'PAYMENT_TIMEOUT_RATE')?.predicate,
    { kind: 'COMPARISON', operator: 'GT', value: 0.5 },
  );
});

test('catalog validates required duration and optional parameters', () => {
  assert.deepEqual(
    validateScenarioParameters('BROWSE_SURGE', { durationSec: 30 }),
    { durationSec: 30, concurrency: 4, requestIntervalMs: 100, pageSize: 20 },
  );
  assert.deepEqual(
    validateScenarioParameters('BROWSE_SURGE', { durationSec: 30, concurrency: 4, requestIntervalMs: 100 }),
    { durationSec: 30, concurrency: 4, requestIntervalMs: 100, pageSize: 20 },
  );
  assert.deepEqual(
    validateScenarioParameters('BROWSE_SURGE', { durationSec: 30, concurrency: 128, pageSize: 100 }),
    { durationSec: 30, concurrency: 128, requestIntervalMs: 100, pageSize: 100 },
  );
  assert.throws(
    () => validateScenarioParameters('BROWSE_SURGE', { durationSec: 30, concurrency: 129 }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'INVALID_PARAMETER:concurrency',
  );
  assert.throws(
    () => validateScenarioParameters('ORDER_QUERY_SURGE', { durationSec: 30, concurrency: 129 }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'INVALID_PARAMETER:concurrency',
  );
  assert.throws(
    () => validateScenarioParameters('ORDER_QUERY_SURGE', { durationSec: 30, pageSize: 101 }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'INVALID_PARAMETER:pageSize',
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
    validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', { durationSec: 30 }),
    {
      durationSec: 30,
      concurrency: 4,
      requestIntervalMs: 100,
      memberCount: 8,
      memberSizeBytes: 32 * 1024 ** 2,
      keyTtlSec: 900,
    },
  );
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
      durationSec: 30, totalBytes: 2 * 1024 ** 3, appendBytes: '64M', minFreeBytes: '50mB',
    }),
    {
      durationSec: 30,
      requestIntervalMs: 100,
      totalBytes: 2 * 1024 ** 3,
      appendBytes: 64 * 1024 ** 2,
      minFreeBytes: 50 * 1024 ** 2,
    },
  );
  assert.deepEqual(
    validateScenarioParameters('NOTIFICATION_STORAGE_APPEND', { durationSec: 30 }),
    {
      durationSec: 30,
      requestIntervalMs: 100,
      totalBytes: 10 * 1024 ** 3,
      appendBytes: 16 * 1024 ** 2,
      minFreeBytes: 1024 ** 2,
    },
  );
  assert.deepEqual(
    validateScenarioParameters('NOTIFICATION_STORAGE_APPEND', {
      durationSec: 30,
      totalBytes: 2 * 1024 ** 4,
      minFreeBytes: 1024 ** 2,
    }),
    {
      durationSec: 30,
      requestIntervalMs: 100,
      totalBytes: 2 * 1024 ** 4,
      appendBytes: 16 * 1024 ** 2,
      minFreeBytes: 1024 ** 2,
    },
  );
  assert.throws(
    () => validateScenarioParameters('NOTIFICATION_STORAGE_APPEND', {
      durationSec: 30,
      minFreeBytes: 1024 ** 2 - 1,
    }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'INVALID_PARAMETER:minFreeBytes',
  );
  assert.throws(
    () => validateScenarioParameters('NOTIFICATION_STORAGE_APPEND', {
      durationSec: 30, appendBytes: 64 * 1024 ** 2 + 1,
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'INVALID_PARAMETER:appendBytes',
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
  assert.throws(() => getScenarioDefinition('toString'));
  assert.throws(() => getScenarioDefinition('constructor'));
  assert.throws(
    () => validateScenarioParameters('BROWSE_SURGE', { durationSec: 1801 }),
    (error: unknown) => error instanceof FaultRunValidationError && error.message === 'DURATION_EXCEEDS_SCENARIO_LIMIT',
  );
});

test('catalog enforces Hash member budget and a TTL that covers the run', () => {
  assert.throws(
    () => validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 30, memberCount: 1, memberSizeBytes: 256, keyTtlSec: 900,
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'INVALID_PARAMETER:memberSizeBytes',
  );
  assert.deepEqual(
    validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 30, memberCount: 4, memberSizeBytes: '128M', keyTtlSec: 900,
    }),
    {
      durationSec: 30,
      concurrency: 4,
      requestIntervalMs: 100,
      memberCount: 4,
      memberSizeBytes: 128 * 1024 ** 2,
      keyTtlSec: 900,
    },
  );
  assert.throws(
    () => validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 30, memberCount: 1, memberSizeBytes: '129M', keyTtlSec: 900,
    }),
    (error: unknown) => error instanceof FaultRunValidationError
      && error.message === 'INVALID_PARAMETER:memberSizeBytes',
  );
  assert.throws(
    () => validateScenarioParameters('CATALOG_REDIS_LARGE_VALUE', {
      durationSec: 600, memberCount: 47, memberSizeBytes: '11M', keyTtlSec: 900,
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
