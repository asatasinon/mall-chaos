import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CustomerRequestContext,
  CustomerSession,
  GatewayClient,
} from '../lib/gateway-client';
import type { TrafficActionRecord, TrafficLifecycleRecord } from '../lib/runner-persistence';
import { CustomerSessionManager } from './customer-session-manager';
import {
  RunnerExecutionConfig,
  TrafficActionOrchestrator,
} from './traffic-action-orchestrator';

function makeContext(): CustomerRequestContext {
  const session: CustomerSession = {
    accountLabel: 'alice',
    customerId: 1,
    accessToken: 'access-token',
    sessionToken: 'session-token',
    expiresAt: new Date(Date.now() + 10 * 60_000),
  };
  return {
    trafficRunId: 'run-1',
    lifecycleId: 'lifecycle-1',
    traceId: 'trace-1',
    session,
    refresh: async () => undefined,
  };
}

function makeSessionManager(context: CustomerRequestContext, onClose: () => void): CustomerSessionManager {
  return {
    openSession: async () => context,
    closeSession: async () => onClose(),
  } as unknown as CustomerSessionManager;
}

function noPersistence() {
  return {
    recordTrafficAction: async (_record: TrafficActionRecord) => undefined,
    recordTrafficLifecycle: async (_record: TrafficLifecycleRecord) => undefined,
  };
}

function config(overrides: Partial<RunnerExecutionConfig> = {}): RunnerExecutionConfig {
  return {
    maxItems: 3,
    maxItemQuantity: 2,
    paymentSuccessRatio: 1,
    couponUsageRatio: 0,
    ...overrides,
  };
}

test('lifecycle keeps existing cart items, adds a new sellable SKU, creates missing address, and pays', async () => {
  const context = makeContext();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let closed = false;
  const gateway = {
    async customerGet(path: string) {
      calls.push({ method: 'GET', path });
      if (path === '/api/products') return {
        code: 200,
        data: { content: [
          { sku: 'SKU-001', price: 10, status: 1, availableQty: 20 },
          { sku: 'SKU-002', price: 30, status: 1, availableQty: 20 },
        ] },
      };
      if (path === '/api/cart') {
        const initial = calls.filter((call) => call.path === '/api/cart').length === 1;
        return { code: 200, data: initial
          ? { id: 9, version: 2, items: [{ id: 1, sku: 'SKU-001', quantity: 1 }] }
          : { id: 9, version: 3, items: [
            { id: 1, sku: 'SKU-001', quantity: 1 },
            { id: 2, sku: 'SKU-002', quantity: 1 },
          ] } };
      }
      if (path === '/api/me/addresses') return { code: 200, data: [] };
      if (path === '/api/orders/101') return { code: 200, data: { id: 101, orderNo: 'ORD-101', status: 'PENDING_PAYMENT' } };
      throw new Error(`unexpected GET ${path}`);
    },
    async customerPost(path: string, body: unknown) {
      calls.push({ method: 'POST', path, body });
      if (path === '/api/cart/items') return { code: 200, data: {} };
      if (path === '/api/me/addresses') return { code: 200, data: { id: 77 } };
      if (path === '/api/checkout') return { code: 200, data: { id: 101, orderNo: 'ORD-101', status: 'PENDING_PAYMENT' } };
      if (path === '/api/orders/101/payment-intents') return { code: 200, data: { id: 501, status: 'CREATED' } };
      if (path === '/api/payments/501/confirm') return { code: 200, data: { id: 501, status: 'SUCCESS' } };
      throw new Error(`unexpected POST ${path}`);
    },
  } as unknown as GatewayClient;
  const orchestrator = new TrafficActionOrchestrator(
    gateway,
    makeSessionManager(context, () => { closed = true; }),
    noPersistence(),
  );

  const result = await orchestrator.executeLifecycle('run-1', config());

  const addCall = calls.find((call) => call.path === '/api/cart/items');
  const checkoutCall = calls.find((call) => call.path === '/api/checkout');
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.customerId, 1);
  assert.equal(result.pendingPaymentRetained, false);
  assert.equal(addCall?.body && (addCall.body as { sku: string }).sku, 'SKU-002');
  assert.equal(calls.some((call) => call.path === '/api/me/addresses' && call.method === 'POST'), true);
  assert.equal((checkoutCall?.body as Record<string, unknown>).couponId, undefined);
  assert.equal(calls.some((call) => call.path === '/api/orders/101'), true);
  assert.equal(closed, true);
});

test('coupon branch selects only a candidate meeting the cart threshold', async () => {
  const context = makeContext();
  const calls: Array<{ path: string; body?: unknown }> = [];
  const gateway = {
    async customerGet(path: string) {
      calls.push({ path });
      if (path === '/api/products') return { data: { content: [
        { sku: 'SKU-001', price: 100, status: 1, availableQty: 10 },
      ] } };
      if (path === '/api/cart') return { data: { id: 9, version: 1, items: [{ id: 1, sku: 'SKU-001', quantity: 1 }] } };
      if (path === '/api/me/addresses') return { data: [{ id: 77, isDefault: true }] };
      if (path === '/api/me/coupons') return { data: [
        { id: 10, minAmount: 150, expireAt: '2099-01-01T00:00:00Z' },
        { id: 11, minAmount: 50, expireAt: '2099-01-01T00:00:00Z' },
      ] };
      if (path === '/api/orders/101') return { data: { id: 101, orderNo: 'ORD-101', status: 'PENDING_PAYMENT' } };
      throw new Error(`unexpected GET ${path}`);
    },
    async customerPost(path: string, body: unknown) {
      calls.push({ path, body });
      if (path === '/api/checkout') return { data: { id: 101, orderNo: 'ORD-101', status: 'PENDING_PAYMENT' } };
      if (path === '/api/orders/101/payment-intents') return { data: { id: 501 } };
      if (path === '/api/payments/501/confirm') return { data: { id: 501, status: 'SUCCESS' } };
      throw new Error(`unexpected POST ${path}`);
    },
  } as unknown as GatewayClient;
  const orchestrator = new TrafficActionOrchestrator(
    gateway,
    makeSessionManager(context, () => undefined),
    noPersistence(),
  );

  const result = await orchestrator.executeLifecycle('run-1', config({ couponUsageRatio: 1 }));
  const checkout = calls.find((call) => call.path === '/api/checkout');

  assert.equal(result.status, 'SUCCESS');
  assert.equal((checkout?.body as { couponId?: number }).couponId, 11);
});

test('cancel branch rechecks pending order and always performs final query', async () => {
  const context = makeContext();
  const paths: string[] = [];
  let orderReads = 0;
  const gateway = {
    async customerGet(path: string) {
      paths.push(`GET ${path}`);
      if (path === '/api/products') return { data: { content: [{ sku: 'SKU-001', price: 20, status: 1, availableQty: 10 }] } };
      if (path === '/api/cart') return { data: { id: 9, version: 1, items: [{ id: 1, sku: 'SKU-001', quantity: 1 }] } };
      if (path === '/api/me/addresses') return { data: [{ id: 77, isDefault: true }] };
      if (path === '/api/orders/101') {
        orderReads++;
        return { data: { id: 101, orderNo: 'ORD-101', status: orderReads < 3 ? 'PENDING_PAYMENT' : 'CANCELLED' } };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    async customerPost(path: string) {
      paths.push(`POST ${path}`);
      if (path === '/api/checkout') return { data: { id: 101, orderNo: 'ORD-101', status: 'PENDING_PAYMENT' } };
      if (path === '/api/orders/101/cancel') return { data: { id: 101, orderNo: 'ORD-101', status: 'CANCELLED' } };
      throw new Error(`unexpected POST ${path}`);
    },
  } as unknown as GatewayClient;
  const orchestrator = new TrafficActionOrchestrator(
    gateway,
    makeSessionManager(context, () => undefined),
    noPersistence(),
  );

  const result = await orchestrator.executeLifecycle('run-1', config({ paymentSuccessRatio: 0 }));

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.pendingPaymentRetained, false);
  assert.equal(paths.filter((path) => path === 'GET /api/orders/101').length, 3);
  assert.equal(paths.includes('POST /api/orders/101/cancel'), true);
  assert.equal(paths.some((path) => path.includes('payment-intents')), false);
});

test('interruption after checkout keeps pending payment and clears the session', async () => {
  const context = makeContext();
  const controller = new AbortController();
  const paths: string[] = [];
  const gateway = {
    async customerGet(path: string) {
      paths.push(`GET ${path}`);
      if (path === '/api/products') return { data: { content: [{ sku: 'SKU-001', price: 20, status: 1, availableQty: 10 }] } };
      if (path === '/api/cart') return { data: { id: 9, version: 1, items: [{ id: 1, sku: 'SKU-001', quantity: 1 }] } };
      if (path === '/api/me/addresses') return { data: [{ id: 77, isDefault: true }] };
      if (path === '/api/orders/101') {
        controller.abort();
        return { data: { id: 101, orderNo: 'ORD-101', status: 'PENDING_PAYMENT' } };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    async customerPost(path: string) {
      paths.push(`POST ${path}`);
      if (path === '/api/checkout') return { data: { id: 101, orderNo: 'ORD-101', status: 'PENDING_PAYMENT' } };
      throw new Error(`unexpected POST ${path}`);
    },
  } as unknown as GatewayClient;
  let closed = false;
  const orchestrator = new TrafficActionOrchestrator(
    gateway,
    makeSessionManager(context, () => { closed = true; }),
    noPersistence(),
  );

  const result = await orchestrator.executeLifecycle('run-1', config(), { signal: controller.signal });

  assert.equal(result.status, 'INTERRUPTED');
  assert.equal(result.pendingPaymentRetained, true);
  assert.equal(result.orderId, '101');
  assert.equal(paths.some((path) => path.includes('/cancel')), false);
  assert.equal(paths.some((path) => path.includes('payment-intents')), false);
  assert.equal(closed, true);
});
