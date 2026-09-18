import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { FaultRunCommandError, type FaultRunCommandResult, type FaultRunRecord } from '@/lib/fault-run-repository';
import { createInitialFaultRunRecoveryProjection } from '@/lib/fault-run-recovery';
import { createFaultRunStopRouteHandler } from '@/lib/fault-run-stop-route-handler';

const csrf = 'a'.repeat(32);
const faultRunId = '11111111-1111-4111-8111-111111111111';

test('accepts a safe stop command without invoking the legacy recovery path', async () => {
  let legacyStops = 0;
  let receivedKey: string | undefined;
  const handler = createFaultRunStopRouteHandler({
    ...baseDependencies(),
    requestStop: async (input) => {
      receivedKey = input.requestKey;
      return commandResult('ACCEPTED');
    },
    legacyStop: async () => {
      legacyStops++;
      return run();
    },
  });

  const response = await handler(commandRequest(), routeContext());

  assert.equal(response.status, 202);
  assert.equal(receivedKey, 'stop-key-123');
  assert.equal(legacyStops, 0);
  assert.deepEqual(await response.json(), {
    code: 0,
    message: 'ok',
    data: { safe: true },
  });
});

test('returns existing safe stop commands without a second legacy recovery', async () => {
  let legacyStops = 0;
  const handler = createFaultRunStopRouteHandler({
    ...baseDependencies(),
    requestStop: async () => commandResult('REPLAYED'),
    legacyStop: async () => {
      legacyStops++;
      return run();
    },
  });

  const response = await handler(commandRequest(), routeContext());

  assert.equal(response.status, 200);
  assert.equal(legacyStops, 0);
});

test('returns stable errors when the safe command conflicts or cannot persist', async () => {
  const conflictHandler = createFaultRunStopRouteHandler({
    ...baseDependencies(),
    requestStop: async () => {
      throw new FaultRunCommandError('STOP_REQUEST_CONFLICT');
    },
  });
  const persistenceHandler = createFaultRunStopRouteHandler({
    ...baseDependencies(),
    requestStop: async () => {
      throw new Error('database unavailable');
    },
  });

  const conflict = await conflictHandler(commandRequest(), routeContext());
  const persistenceFailure = await persistenceHandler(commandRequest(), routeContext());

  assert.deepEqual(await conflict.json(), {
    code: 409,
    message: 'Fault Run stop request conflicts with its current recovery state',
    data: null,
  });
  assert.deepEqual(await persistenceFailure.json(), {
    code: 502,
    message: 'Failed to stop Fault Run',
    data: null,
  });
});

test('rejects a missing CSRF token before accepting a stop command', async () => {
  let requested = false;
  const handler = createFaultRunStopRouteHandler({
    ...baseDependencies(),
    requestStop: async () => {
      requested = true;
      return commandResult('ACCEPTED');
    },
  });
  const request = new NextRequest('http://localhost/internal/fault-runs/test/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'stop-key-123',
    },
    body: JSON.stringify({ confirmed: true }),
  });

  const response = await handler(request, routeContext());

  assert.equal(response.status, 403);
  assert.equal(requested, false);
});

function baseDependencies() {
  return {
    safeRuntimeEnabled: () => true,
    requestStop: async () => commandResult('ACCEPTED'),
    legacyStop: async () => {
      throw new Error('legacy recovery must not execute');
    },
    recordAudit: async () => 1,
    attachAudit: async () => {},
    operatorId: () => 7,
    buildRun: () => ({ safe: true }),
    traceId: () => 'trace-id',
  };
}

function commandRequest(): NextRequest {
  return new NextRequest(`http://localhost/internal/fault-runs/${faultRunId}/stop`, {
    method: 'POST',
    headers: {
      Cookie: `operator_csrf=${csrf}`,
      'X-CSRF-Token': csrf,
      'X-Idempotency-Key': 'stop-key-123',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmed: true }),
  });
}

function routeContext() {
  return { params: Promise.resolve({ faultRunId }) };
}

function commandResult(disposition: FaultRunCommandResult['disposition']): FaultRunCommandResult {
  return {
    disposition,
    run: run(),
    recovery: {
      kind: 'SAFE_RUNTIME_V1',
      projection: createInitialFaultRunRecoveryProjection({
        reason: 'MANUAL',
        requestedAt: '2026-09-18T00:00:00.000Z',
        drainDeadlineAt: '2026-09-18T00:00:30.000Z',
        recoveryDeadlineAt: '2026-09-18T00:01:00.000Z',
      }),
    },
  };
}

function run(): FaultRunRecord {
  return {
    faultRunId,
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    state: 'RECOVERING',
    parameters: { durationSec: 60 },
    idempotencyKey: 'server-only-key',
    fencingToken: 1,
    startedAt: '2026-09-18T00:00:00.000Z',
    expiresAt: '2026-09-18T00:01:00.000Z',
    stoppedAt: '2026-09-18T00:00:01.000Z',
    stopReason: 'MANUAL',
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: 1,
    traceId: 'server-only-trace',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:01.000Z',
  };
}
