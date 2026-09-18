import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from './route';

const csrf = 'a'.repeat(32);

test('rejects runless cleanup without reading state or dispatching an operation', async () => {
  const request = new NextRequest('http://localhost/internal/fault-runs/cleanup-scenario', {
    method: 'POST',
    headers: {
      Cookie: `operator_csrf=${csrf}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scenario: 'NOTIFICATION_STORAGE_APPEND',
      confirmed: true,
    }),
  });

  const response = await POST(request);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    code: 409,
    message: 'SCENARIO_CLEANUP_REQUIRES_RUN',
    data: null,
  });
});
