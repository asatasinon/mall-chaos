import assert from 'node:assert/strict';
import test from 'node:test';
import { LIFECYCLE_INTERVALS, validateRunnerConfigUpdate, type RunnerConfig } from './runner-config';

const currentConfig: RunnerConfig = {
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

test('supports a five-second lifecycle interval', () => {
  assert.deepEqual(LIFECYCLE_INTERVALS, [60, 30, 20, 10, 5]);
  assert.doesNotThrow(() => validateRunnerConfigUpdate({ version: 1, lifecycleIntervalSec: 5 }, currentConfig));
});

test('rejects lifecycle intervals outside the configured options', () => {
  assert.throws(
    () => validateRunnerConfigUpdate({ version: 1, lifecycleIntervalSec: 1 }, currentConfig),
    /INVALID_RUNNER_CONFIG/,
  );
});