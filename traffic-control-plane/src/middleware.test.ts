import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { config, middleware } from './middleware';

test('requires an Operator session before internal Fault Run routes execute', async () => {
  const response = await middleware(new NextRequest(
    'http://localhost/internal/fault-runs/11111111-1111-4111-8111-111111111111/stop',
    { method: 'POST' },
  ));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: 401,
    message: 'Operator authentication required',
    data: null,
  });
  assert.ok(config.matcher.includes('/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'));
});
