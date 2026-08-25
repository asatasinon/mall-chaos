import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayClient } from '../lib/gateway-client';
import { LIFECYCLE_INTERVALS, RunnerConfig, RunnerConfigUpdate, validateRunnerConfigUpdate } from '../lib/runner-config';
import { RUNNER_ACTIONS } from './traffic-action-orchestrator';

test('runner exposes the complete customer action contract', () => {
  assert.deepEqual([...RUNNER_ACTIONS], [
    'BROWSE_PRODUCT',
    'SEARCH_CATALOG',
    'ADD_CART_ITEM',
    'UPDATE_CART_ITEM',
    'CHECKOUT',
    'PAYMENT_CONFIRM',
    'CANCEL_PENDING_ORDER',
    'QUERY_ORDER',
    'QUERY_SHIPMENT',
  ]);
});

test('lifecycle interval contract only exposes supported values', () => {
  assert.deepEqual([...LIFECYCLE_INTERVALS], [60, 30, 20, 10]);
});

test('lifecycle config rejects invalid values and legacy fields', () => {
  const current: RunnerConfig = {
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

  assert.throws(
    () => validateRunnerConfigUpdate({ version: 1, lifecycleIntervalSec: 15 }, current),
    /INVALID_RUNNER_CONFIG/,
  );
  assert.throws(
    () => validateRunnerConfigUpdate({ version: 1, successfulPaymentRatio: 1.1 }, current),
    /INVALID_RUNNER_CONFIG/,
  );
  assert.throws(
    () => validateRunnerConfigUpdate({ version: 1, enabled: 'true' } as unknown as RunnerConfigUpdate, current),
    /INVALID_RUNNER_CONFIG/,
  );
  assert.throws(
    () => validateRunnerConfigUpdate({ version: 1, baseQps: 5 } as unknown as RunnerConfigUpdate, current),
    /INVALID_RUNNER_CONFIG/,
  );
});

test('GatewayClient sends runner customer and correlation context', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 });
  };

  try {
    const gateway = new GatewayClient('http://gateway.test');
    await gateway.get('/api/products', undefined, {
      customerId: 2,
      trafficRunId: 'run-1',
      action: 'SEARCH_CATALOG',
      traceId: 'trace-1',
    });
    assert.equal(capturedHeaders?.get('X-Traffic-Runner-Customer-Id'), '2');
    assert.equal(capturedHeaders?.get('X-Traffic-Run-Id'), 'run-1');
    assert.equal(capturedHeaders?.get('X-Traffic-Runner-Action'), 'SEARCH_CATALOG');
    assert.equal(capturedHeaders?.get('X-Trace-Id'), 'trace-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
