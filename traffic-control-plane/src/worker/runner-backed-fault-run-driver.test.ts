import assert from 'node:assert/strict';
import test from 'node:test';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import type { RunnerConfig } from '../lib/runner-config';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import { RunnerBackedFaultRunDriver } from './runner-backed-fault-run-driver';

function run(scenario: FaultRunRecord['scenario']): FaultRunRecord {
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174099',
    scenario,
    targetService: 'notification-service',
    targetOperation: 'notification-retention',
    state: 'ACTIVE',
    parameters: { durationSec: 60 },
    idempotencyKey: 'runner-driver-test-key',
    fencingToken: 1,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'runner-driver-test-trace',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const config: RunnerConfig = {
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

test('runner-backed driver owns only the runner-backed Fault Run scenarios', () => {
  const driver = new RunnerBackedFaultRunDriver({
    loadConfig: async () => config,
    orchestrator: {
      executeLifecycle: async () => {
        throw new Error('not started in supports-only test');
      },
      executeStorageGrowth: async () => {
        throw new Error('not started in supports-only test');
      },
    },
  });

  assert.equal(driver.supports(run('NOTIFICATION_HEAP_PRESSURE')), true);
  assert.equal(driver.supports(run('NOTIFICATION_STORAGE_APPEND')), true);
  assert.equal(driver.supports(run('PSP_PROVIDER_OUTCOME')), true);
  assert.equal(driver.supports(run('BROWSE_REPORT_SQL')), false);
});

test('runner-backed lifecycle does not receive Fault Run context and drains on owner loss', async () => {
  let receivedContextFieldPresent = true;
  const driver = new RunnerBackedFaultRunDriver({
    loadConfig: async () => config,
    orchestrator: {
      executeLifecycle: async (_trafficRunId, _config, options) => {
        receivedContextFieldPresent = Object.prototype.hasOwnProperty.call(options ?? {}, 'faultRunContext');
        return {
          actionId: 'action-1',
          lifecycleId: 'lifecycle-1',
          customerId: 1,
          traceId: 'trace-1',
          success: true,
          status: 'SUCCESS',
          steps: [],
        };
      },
      executeStorageGrowth: async () => {
        throw new Error('storage path not used');
      },
    },
    appendEvent: async () => undefined,
  });
  const fence = new FaultRunOwnerFence(run('PSP_PROVIDER_OUTCOME').faultRunId, 'worker-a', 1);
  const handle = await driver.start({ run: run('PSP_PROVIDER_OUTCOME'), fence });
  const result = await handle.stop({ reason: 'OWNER_LOST', signal: fence.signal });

  assert.equal(receivedContextFieldPresent, false);
  assert.equal(result.drained, true);
});
