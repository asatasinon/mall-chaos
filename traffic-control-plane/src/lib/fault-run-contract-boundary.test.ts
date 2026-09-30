import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayClient } from './gateway-client';
import { GatewayFaultRunTargetAdapter } from './fault-run-coordinator';
import type { FaultRunRecord } from './fault-run-repository';

test('Gateway prepare and cleanup contain no Contract or Catalog revision in body or headers', async () => {
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({ code: 200, message: 'ok', data: {} });
  };

  const run: FaultRunRecord & { catalogRevision: string } = {
    faultRunId: '123e4567-e89b-12d3-a456-426614174000',
    scenario: 'BROWSE_REPORT_SQL',
    targetService: 'catalog-service',
    targetOperation: 'products-browse-report',
    state: 'CREATING',
    parameters: { durationSec: 30 },
    contractRevision: 'sc.v1:sha256:' + 'a'.repeat(64),
    catalogRevision: 'b'.repeat(64),
    idempotencyKey: 'gateway-boundary-test-001',
    fencingToken: 7,
    startedAt: null,
    expiresAt: '2026-09-30T12:00:00.000Z',
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-gateway-boundary',
    createdAt: '2026-09-30T11:00:00.000Z',
    updatedAt: '2026-09-30T11:00:00.000Z',
  };

  try {
    const adapter = new GatewayFaultRunTargetAdapter(new GatewayClient('http://gateway.test'));
    await adapter.start(run);
    await adapter.cleanup(run);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 2);
  const prepareBody = requests[0]?.body;
  const cleanupBody = requests[1]?.body;
  assert.ok(prepareBody && typeof prepareBody === 'object');
  assert.ok(cleanupBody && typeof cleanupBody === 'object');
  assert.deepEqual(Object.keys(prepareBody).sort(), [
    'expiresAt',
    'fencingToken',
    'idempotencyKey',
    'operation',
    'parameters',
    'runId',
  ]);
  assert.deepEqual(Object.keys(cleanupBody).sort(), [
    'fencingToken',
    'operation',
    'runId',
  ]);
  for (const request of requests) {
    assert.equal(request.headers.has('contractRevision'), false);
    assert.equal(request.headers.has('catalogRevision'), false);
    assert.equal(JSON.stringify(request.body).includes('Revision'), false);
  }
});

test('customer business requests and responses do not inherit revision fields from control context', async () => {
  const originalFetch = globalThis.fetch;
  let requestHeaders = new Headers();
  let requestBody: unknown;
  const customerResponse = { code: 200, data: { sku: 'SKU-001' } };
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body));
    return Response.json(customerResponse);
  };

  try {
    const client = new GatewayClient('http://gateway.test');
    const contextWithRevision = {
      trafficRunId: 'internal-traffic-run',
      lifecycleId: 'internal-lifecycle',
      traceId: 'trace-customer-boundary',
      session: {
        accountLabel: 'lifecycle',
        customerId: 19,
        accessToken: 'access-token',
        sessionToken: 'session-token',
        expiresAt: new Date(Date.now() + 60_000),
      },
      refresh: async () => undefined,
      contractRevision: 'sc.v1:sha256:' + 'a'.repeat(64),
      catalogRevision: 'b'.repeat(64),
    };
    const response = await client.customerPost('/api/cart/items', { sku: 'SKU-001' }, contextWithRevision);

    assert.deepEqual(response, customerResponse);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requestBody, { sku: 'SKU-001' });
  assert.equal(requestHeaders.has('contractRevision'), false);
  assert.equal(requestHeaders.has('catalogRevision'), false);
  assert.equal(requestHeaders.has('X-Internal-Service-Key'), false);
  assert.equal(JSON.stringify(requestBody).includes('Revision'), false);
  assert.equal(JSON.stringify(customerResponse).includes('Revision'), false);
});
