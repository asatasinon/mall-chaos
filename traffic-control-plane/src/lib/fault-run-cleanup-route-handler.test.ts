import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { FaultRunCommandError, type FaultRunCommandResult, type FaultRunRecord } from '@/lib/fault-run-repository';
import { createInitialFaultRunRecoveryProjection } from '@/lib/fault-run-recovery';
import { createFaultRunCleanupRouteHandler } from '@/lib/fault-run-cleanup-route-handler';

const csrf = 'b'.repeat(32);
const faultRunId = '22222222-2222-4222-8222-222222222222';

test('accepts a safe cleanup command without loading or directly cleaning the target', async () => {
  let loads = 0;
  let legacyCleanups = 0;
  let receivedKey: string | undefined;
  const handler = createFaultRunCleanupRouteHandler({
    ...baseDependencies(),
    requestManualCleanup: async (input) => {
      receivedKey = input.requestKey;
      return commandResult('ACCEPTED');
    },
    loadRun: async () => {
      loads++;
      return run();
    },
    legacyCleanup: async () => {
      legacyCleanups++;
      return {};
    },
  });

  const response = await handler(commandRequest(), routeContext());

  assert.equal(response.status, 202);
  assert.equal(receivedKey, 'cleanup-key-123');
  assert.equal(loads, 0);
  assert.equal(legacyCleanups, 0);
  assert.deepEqual(await response.json(), {
    code: 0,
    message: 'ok',
    data: { safe: true },
  });
});

test('returns an existing cleanup command without loading or directly cleaning the target', async () => {
  let legacyCleanups = 0;
  const handler = createFaultRunCleanupRouteHandler({
    ...baseDependencies(),
    requestManualCleanup: async () => commandResult('REPLAYED'),
    legacyCleanup: async () => {
      legacyCleanups++;
      return {};
    },
  });

  const response = await handler(commandRequest(), routeContext());

  assert.equal(response.status, 200);
  assert.equal(legacyCleanups, 0);
});

test('returns stable cleanup command errors without calling the target', async () => {
  let legacyCleanups = 0;
  const conflictHandler = createFaultRunCleanupRouteHandler({
    ...baseDependencies(),
    requestManualCleanup: async () => {
      throw new FaultRunCommandError('CLEANUP_STATE_INVALID');
    },
    legacyCleanup: async () => {
      legacyCleanups++;
      return {};
    },
  });
  const persistenceHandler = createFaultRunCleanupRouteHandler({
    ...baseDependencies(),
    requestManualCleanup: async () => {
      throw new Error('database unavailable');
    },
    legacyCleanup: async () => {
      legacyCleanups++;
      return {};
    },
  });

  const conflict = await conflictHandler(commandRequest(), routeContext());
  const persistenceFailure = await persistenceHandler(commandRequest(), routeContext());

  assert.deepEqual(await conflict.json(), {
    code: 409,
    message: 'Fault Run cleanup conflicts with its current recovery state',
    data: null,
  });
  assert.deepEqual(await persistenceFailure.json(), {
    code: 502,
    message: 'Failed to accept Fault Run cleanup',
    data: null,
  });
  assert.equal(legacyCleanups, 0);
});

test('requires confirmation and CSRF before accepting a cleanup command', async () => {
  let requested = false;
  const handler = createFaultRunCleanupRouteHandler({
    ...baseDependencies(),
    requestManualCleanup: async () => {
      requested = true;
      return commandResult('ACCEPTED');
    },
  });
  const request = new NextRequest(`http://localhost/internal/fault-runs/${faultRunId}/cleanup`, {
    method: 'POST',
    headers: {
      Cookie: `operator_csrf=${csrf}`,
      'X-CSRF-Token': csrf,
      'X-Idempotency-Key': 'cleanup-key-123',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmed: false }),
  });

  const response = await handler(request, routeContext());

  assert.equal(response.status, 400);
  assert.equal(requested, false);
});

function baseDependencies() {
  return {
    safeRuntimeEnabled: () => true,
    requestManualCleanup: async () => commandResult('ACCEPTED'),
    loadRun: async () => {
      throw new Error('legacy load must not execute');
    },
    legacyCleanup: async () => {
      throw new Error('legacy cleanup must not execute');
    },
    appendEvent: async () => {},
    recordAudit: async () => 1,
    operatorId: () => 7,
    buildRun: () => ({ safe: true }),
    traceId: () => 'trace-id',
  };
}

function commandRequest(): NextRequest {
  return new NextRequest(`http://localhost/internal/fault-runs/${faultRunId}/cleanup`, {
    method: 'POST',
    headers: {
      Cookie: `operator_csrf=${csrf}`,
      'X-CSRF-Token': csrf,
      'X-Idempotency-Key': 'cleanup-key-123',
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
