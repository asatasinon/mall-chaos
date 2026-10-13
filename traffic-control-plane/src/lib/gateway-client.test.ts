import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GatewayBoundedReadError,
  GatewayClient,
  type GatewayEvidenceReadPath,
} from './gateway-client';

test('bounded Gateway reads allow only the two fixed business paths and static query parameters', async () => {
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const gateway = new GatewayClient('http://gateway.internal', async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return jsonResponse({ code: 200, message: 'OK', data: { content: [] } });
  });

  await gateway.getBoundedEvidenceRead(
    '/api/products',
    { sort: 'latest', page: '0', size: '1' },
    { maxResponseBytes: 1024 },
  );
  await gateway.getBoundedEvidenceRead(
    '/api/reports/product-browse',
    undefined,
    { maxResponseBytes: 1024 },
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url.pathname, '/api/products');
  assert.equal(requests[0]?.url.search, '?sort=latest&page=0&size=1');
  assert.equal(requests[1]?.url.pathname, '/api/reports/product-browse');
  assert.equal(requests[0]?.init?.method, 'GET');
  assert.equal(requests[0]?.init?.redirect, 'manual');
  assert.equal(requests[0]?.init?.cache, 'no-store');
  assert.equal(requests[0]?.init?.body, undefined);
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.has('Authorization'), false);
  assert.equal(headers.has('X-Internal-Service-Key'), false);
  assert.equal(headers.has('X-Run-Id'), false);
  assert.equal(requests[0]?.url.origin, 'http://gateway.internal');
});

test('bounded Gateway reads reject arbitrary paths and parameter changes before fetch', async () => {
  let requests = 0;
  const gateway = new GatewayClient('http://gateway.internal', async () => {
    requests++;
    return jsonResponse({});
  });
  const validPath = '/api/products' as GatewayEvidenceReadPath;

  for (const [path, params] of [
    ['/api/admin', undefined],
    [validPath, { sort: 'latest', page: '0', size: '100' }],
    ['/api/reports/product-browse', { customerId: '19' }],
  ] as const) {
    await assert.rejects(
      gateway.getBoundedEvidenceRead(path, params, { maxResponseBytes: 1024 }),
      (error: unknown) => error instanceof GatewayBoundedReadError
        && error.code === 'PATH_NOT_ALLOWED',
    );
  }
  assert.equal(requests, 0);
});

test('bounded Gateway reads reject redirects, oversized bodies and malformed JSON safely', async () => {
  for (const [response, code] of [
    [new Response('', { status: 302, headers: { location: 'http://other.internal/' } }), 'REDIRECT_REJECTED'],
    [new Response('x'.repeat(2048), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '2048' },
    }), 'RESPONSE_TOO_LARGE'],
    [new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }), 'RESPONSE_INVALID'],
  ] as const) {
    const gateway = new GatewayClient('http://gateway.internal', async () => response);
    await assert.rejects(
      gateway.getBoundedEvidenceRead(
        '/api/reports/product-browse',
        undefined,
        { maxResponseBytes: 1024 },
      ),
      (error: unknown) => error instanceof GatewayBoundedReadError && error.code === code,
    );
  }
});

test('bounded Gateway response projection retains only parsed body and the cache header', async () => {
  const gateway = new GatewayClient('http://gateway.internal', async () => new Response(
    JSON.stringify({ code: 200, message: 'OK', data: [] }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-castrel-cache-result': 'MISS',
      },
    },
  ));
  const result = await gateway.getBoundedEvidenceRead(
    '/api/reports/product-browse',
    undefined,
    { maxResponseBytes: 1024 },
  );
  assert.deepEqual(result, {
    body: { code: 200, message: 'OK', data: [] },
    cacheResult: 'MISS',
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
