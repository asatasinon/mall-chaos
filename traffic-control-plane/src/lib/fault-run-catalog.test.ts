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
  assert.equal(getScenarioDefinition('CART_REDIS_LARGE_VALUE').targetService, 'cart-service');
  assert.equal(getScenarioDefinition('INVENTORY_TABLE_EXCLUSIVE').targetOperation, 'inventory-availability-report');
});

test('catalog validates required duration and bounded optional parameters', () => {
  assert.deepEqual(
    validateScenarioParameters('BROWSE_SURGE', { durationSec: 30 }),
    { durationSec: 30, concurrency: 4, requestIntervalMs: 1000, pageSize: 20 },
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
