import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CustomerRequestContext,
  CustomerSession,
  GatewayClient,
} from '../lib/gateway-client';

function session(expiresAt = new Date(Date.now() + 10 * 60_000)): CustomerSession {
  return {
    accountLabel: 'alice',
    customerId: 1,
    accessToken: 'access-old',
    sessionToken: 'session-old',
    expiresAt,
  };
}

function context(current: CustomerSession, refresh: () => Promise<void>): CustomerRequestContext {
  return {
    trafficRunId: 'run-1',
    lifecycleId: 'lifecycle-1',
    traceId: 'trace-1',
    session: current,
    refresh,
  };
}

test('customer login, refresh, and logout use trace without runner headers', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const url = String(input);
    if (url.endsWith('/api/auth/login')) {
      return new Response(JSON.stringify({ code: 200, data: {
        userId: 1,
        accessToken: 'access-token',
        sessionToken: 'session-token',
        expiresAt: '2026-08-25T01:15:00',
        roles: ['CUSTOMER'],
      } }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 200, data: null }), { status: 200 });
  };

  try {
    const gateway = new GatewayClient('http://gateway.test');
    const auth = await gateway.login('alice@example.com', 'password-123', 'trace-login');
    await gateway.refresh(auth.sessionToken, 'trace-refresh');
    await gateway.logout(auth.sessionToken, 'trace-logout');

    assert.equal(requests.length, 3);
    assert.equal(requests[0].headers.get('X-Trace-Id'), 'trace-login');
    assert.equal(requests[1].headers.get('X-Trace-Id'), 'trace-refresh');
    assert.equal(requests[1].headers.get('X-Session-Token'), 'session-token');
    assert.equal(requests[2].headers.get('X-Trace-Id'), 'trace-logout');
    assert.equal(requests[2].headers.get('X-Session-Token'), 'session-token');
    for (const request of requests) {
      assert.equal(request.headers.get('X-Traffic-Runner-Credential'), null);
      assert.equal(request.headers.get('X-Traffic-Runner-Customer-Id'), null);
      assert.equal(request.headers.get('X-Traffic-Run-Id'), null);
      assert.equal(request.headers.get('X-Traffic-Runner-Action'), null);
    }
    assert.match(requests[0].body, /alice@example.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('customer request refreshes once after the first 401 and retries with the new bearer token', async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ headers: Headers; url: string }> = [];
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    captured.push({ url: String(input), headers: new Headers(init?.headers) });
    calls++;
    if (calls === 1) return new Response('', { status: 401 });
    return new Response(JSON.stringify({ code: 200, data: { id: 1 } }), { status: 200 });
  };

  try {
    const gateway = new GatewayClient('http://gateway.test');
    const current = session();
    let refreshes = 0;
    const requestContext = context(current, async () => {
      refreshes++;
      current.accessToken = 'access-new';
      current.sessionToken = 'session-new';
    });
    const result = await gateway.customerGet('/api/me', undefined, requestContext);

    assert.deepEqual(result, { code: 200, data: { id: 1 } });
    assert.equal(refreshes, 1);
    assert.equal(captured[0].headers.get('Authorization'), 'Bearer access-old');
    assert.equal(captured[1].headers.get('Authorization'), 'Bearer access-new');
    assert.equal(captured[0].headers.get('X-Trace-Id'), 'trace-1');
    assert.equal(captured[1].headers.get('X-Trace-Id'), 'trace-1');
    assert.equal(captured[0].headers.get('X-Traffic-Run-Id'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('near-expiry customer request refreshes at most once before sending', async () => {
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  let authorization = '';
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(JSON.stringify({ code: 200, data: [] }), { status: 200 });
  };

  try {
    const gateway = new GatewayClient('http://gateway.test');
    const current = session(new Date(Date.now() + 10));
    const result = await gateway.customerGet('/api/products', undefined, context(current, async () => {
      refreshes++;
      current.accessToken = 'access-refreshed';
    }));

    assert.deepEqual(result, { code: 200, data: [] });
    assert.equal(refreshes, 1);
    assert.equal(authorization, 'Bearer access-refreshed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('customer errors do not include response bodies or credentials', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'password=password-123 accessToken=access-secret sessionToken=session-secret',
    { status: 500 },
  );

  try {
    const gateway = new GatewayClient('http://gateway.test');
    const error = await assert.rejects(
      gateway.customerGet('/api/me', undefined, context(session(), async () => undefined)),
      Error,
    ) as Error;
    assert.equal(error.message.includes('password-123'), false);
    assert.equal(error.message.includes('access-secret'), false);
    assert.equal(error.message.includes('session-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
