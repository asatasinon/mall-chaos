import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFaultRunOperatorDetails,
  buildFaultRunOperatorRun,
} from './fault-run-operator-view';
import {
  createInitialFaultRunRecoveryProjection,
  type FaultRunRecoveryProjection,
} from './fault-run-recovery';
import type { FaultRunRecord } from './fault-run-repository';

const faultRunId = '123e4567-e89b-12d3-a456-426614174000';
const requestedAt = '2026-09-18T00:00:00.000Z';
const drainAt = '2026-09-18T00:00:30.000Z';
const recoveryAt = '2026-09-18T00:01:00.000Z';

function createRun(overrides: Partial<FaultRunRecord> = {}): FaultRunRecord {
  return {
    faultRunId,
    scenario: 'CATALOG_REDIS_LARGE_VALUE',
    targetService: 'catalog-service',
    targetOperation: 'product-detail-cache',
    state: 'RECOVERING',
    parameters: {
      durationSec: 60,
      concurrency: 1,
      requestIntervalMs: 0,
      memberCount: 2,
      memberSizeBytes: 1024,
      keyTtlSec: 120,
    },
    idempotencyKey: 'create-request-key-must-not-leave-server',
    fencingToken: 99,
    startedAt: requestedAt,
    expiresAt: '2026-09-18T00:10:00.000Z',
    stoppedAt: null,
    stopReason: 'MANUAL',
    recoveryResult: initialProjection(),
    recoveryError: 'target response must not leave server',
    operatorAuditId: 7,
    traceId: 'trace-must-not-leave-server',
    createdAt: requestedAt,
    updatedAt: requestedAt,
    ...overrides,
  };
}

function initialProjection(): FaultRunRecoveryProjection {
  return createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
    requestKeyHash: 'a'.repeat(64),
  });
}

test('builds a strict recovery view without server-only identifiers or request-key hashes', () => {
  const view = buildFaultRunOperatorRun(createRun());

  assert.equal(view.recovery.kind, 'SAFE_RUNTIME_V1');
  assert.equal(view.targetOperation, 'product-detail-cache');
  assert.equal(view.parameterStatus, 'VALIDATED');
  assert.equal(view.parameterIssue, null);
  assert.equal(JSON.stringify(view).includes('create-request-key-must-not-leave-server'), false);
  assert.equal(JSON.stringify(view).includes('trace-must-not-leave-server'), false);
  assert.equal(JSON.stringify(view).includes('target response must not leave server'), false);
  assert.equal(JSON.stringify(view).includes('a'.repeat(64)), false);
  if (view.recovery.kind === 'SAFE_RUNTIME_V1') {
    assert.equal(view.recovery.projection.stop.reason, 'MANUAL');
    assert.equal('requestKeyHash' in view.recovery.projection.cleanup, false);
  }
});

test('does not infer recovery success from malformed or legacy recovery data', () => {
  const malformed = buildFaultRunOperatorRun(createRun({
    recoveryResult: {
      ...initialProjection(),
      targetResponse: { password: 'must not be exposed' },
    },
  }));
  const legacy = buildFaultRunOperatorRun(createRun({
    recoveryResult: { released: true, cleanup: { secret: 'must not be exposed' } },
  }));

  assert.deepEqual(malformed.recovery, {
    kind: 'UNKNOWN',
    projection: null,
    reason: 'INVALID_SHAPE',
  });
  assert.deepEqual(legacy.recovery, { kind: 'LEGACY', projection: null });
});

test('keeps historical parameter values readable without treating them as current catalog validation', () => {
  const view = buildFaultRunOperatorRun(createRun({
    parameters: {
      durationSec: 60,
      concurrency: 1,
      requestIntervalMs: 0,
      memberCount: 2,
      memberSizeBytes: 256,
      keyTtlSec: 120,
    },
  }));

  assert.equal(view.parameterStatus, 'LEGACY');
  assert.equal(view.parameterIssue, 'INVALID_PARAMETER:memberSizeBytes');
  assert.equal(view.parameters.memberSizeBytes, 256);

  const unknownFieldView = buildFaultRunOperatorRun(createRun({
    parameters: {
      durationSec: 60,
      ignoredHistoricalField: 'must not be exposed',
    },
  }));
  assert.equal(unknownFieldView.parameterStatus, 'LEGACY');
  assert.equal(unknownFieldView.parameterIssue, 'UNKNOWN_PARAMETER:ignoredHistoricalField');
  assert.equal('ignoredHistoricalField' in unknownFieldView.parameters, false);
});

test('only exposes allowlisted event facts and audit fields', () => {
  const details = buildFaultRunOperatorDetails(
    createRun(),
    [
      {
        id: 1,
        faultRunId,
        eventType: 'STOP_REQUESTED',
        payload: {
          reason: 'MANUAL',
          attempt: 1,
          drainDeadlineAt: drainAt,
          recoveryDeadlineAt: recoveryAt,
          operatorAuditId: 7,
          password: 'must not be exposed',
        },
        createdAt: requestedAt,
      },
      {
        id: 2,
        faultRunId,
        eventType: 'TARGET_CONFIRMED',
        payload: {
          targetService: 'catalog-service',
          targetSummary: {
            layout: 'HASH',
            hashKey: `catalog:product-detail:operation:${faultRunId}`,
            memberCount: 2,
            memberSizeBytes: 1024,
            logicalBytes: 2048,
            observedBytes: 2048,
            probeSku: 'SKU-003',
            memberSkus: ['SKU-001', 'SKU-002'],
            keyTtlSec: 120,
            secret: 'must not be exposed',
          },
        },
        createdAt: requestedAt,
      },
      {
        id: 3,
        faultRunId,
        eventType: 'UNTRUSTED_EVENT',
        payload: { stack: 'must not be exposed' },
        createdAt: requestedAt,
      },
    ],
    {
      id: 7,
      operatorId: 3,
      action: 'FAULT_RUN_STOP',
      target: 'CATALOG_REDIS_LARGE_VALUE',
      parameterHash: 'parameter-hash-must-not-leave-server',
      result: 'SUCCESS',
      correlationId: 'trace-must-not-leave-server',
      createdAt: requestedAt,
    },
    [],
  );

  assert.deepEqual(details.events[0]?.payload, {
    schemaVersion: 1,
    source: 'safe-runtime',
    phase: 'command',
    status: 'REQUESTED',
    reason: 'MANUAL',
    attempt: 1,
    drainDeadlineAt: drainAt,
    recoveryDeadlineAt: recoveryAt,
    operatorAuditId: 7,
    auditAction: 'FAULT_RUN_STOP',
    auditResult: 'SUCCESS',
  });
  assert.equal(details.events[1]?.payload.targetSummary !== undefined, true);
  assert.deepEqual(details.events[2]?.payload, {});
  assert.equal(JSON.stringify(details).includes('must not be exposed'), false);
  assert.deepEqual(details.audit, {
    id: 7,
    operatorId: 3,
    action: 'FAULT_RUN_STOP',
    target: 'CATALOG_REDIS_LARGE_VALUE',
    result: 'SUCCESS',
    createdAt: requestedAt,
  });
});
