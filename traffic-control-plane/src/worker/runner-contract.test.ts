import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayClient } from '../lib/gateway-client';
import {
  choosePaymentStrategy,
  RUNNER_ACTIONS,
  RunnerExecutionConfig,
} from './traffic-action-orchestrator';

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

test('runner payment strategy follows configured buckets', () => {
  const config: RunnerExecutionConfig = {
    maxItems: 3,
    maxItemQuantity: 3,
    paymentSuccessRatio: 0.6,
    paymentFailureRatio: 0.2,
    paymentUnknownRatio: 0.2,
  };
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.1;
    assert.equal(choosePaymentStrategy(config), 'SUCCESS');
    Math.random = () => 0.7;
    assert.equal(choosePaymentStrategy(config), 'FAILED');
    Math.random = () => 0.95;
    assert.equal(choosePaymentStrategy(config), 'UNKNOWN');
  } finally {
    Math.random = originalRandom;
  }
});

test('runner payment strategy is always successful without failure injection', () => {
  const config: RunnerExecutionConfig = {
    maxItems: 3,
    maxItemQuantity: 3,
    paymentSuccessRatio: 1,
    paymentFailureRatio: 0,
    paymentUnknownRatio: 0,
  };
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(choosePaymentStrategy(config), 'SUCCESS');
    Math.random = () => 0.999999;
    assert.equal(choosePaymentStrategy(config), 'SUCCESS');
  } finally {
    Math.random = originalRandom;
  }
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
