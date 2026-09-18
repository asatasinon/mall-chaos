import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFaultRunView,
  isManualCleanupAvailable,
  requiresNotificationServiceRecovery,
  summarizeFaultRunEvent,
} from './fault-run-view';
import {
  createInitialFaultRunRecoveryProjection,
  type FaultRunRecoveryProjection,
} from '@/lib/fault-run-recovery';
import type { FaultRun, FaultRunDetails } from './types';

const faultRunId = '123e4567-e89b-12d3-a456-426614174000';

test('builds a safe Catalog Hash view from target, worker, recovery, and audit events', () => {
  const details: FaultRunDetails = {
    run: {
      faultRunId,
      scenario: 'CATALOG_REDIS_LARGE_VALUE',
      targetService: 'catalog-service',
      targetOperation: 'product-detail-cache',
      state: 'STOPPED',
      parameters: {
        durationSec: 60,
        memberCount: 2,
        memberSizeBytes: 1024,
        concurrency: 2,
        requestIntervalMs: 100,
        keyTtlSec: 120,
      },
      expiresAt: '2026-09-02T07:00:00.000Z',
      createdAt: '2026-09-02T06:59:00.000Z',
      recovery: { kind: 'ABSENT', projection: null },
      manualCleanup: 'UNAVAILABLE',
      operatorAuditId: 7,
    },
    events: [
      {
        id: 1,
        eventType: 'TARGET_CONFIRMED',
        payload: {
          targetSummary: {
            layout: 'HASH',
            hashKey: `catalog:product-detail:operation:${faultRunId}`,
            memberCount: 2,
            memberSizeBytes: 1024,
            logicalBytes: 2048,
            observedBytes: 2848,
            probeSku: 'SKU-049',
            memberSkus: ['SKU-001', 'SKU-002'],
            keyTtlSec: 120,
            expiresAt: '2026-09-02T07:00:00.000Z',
          },
        },
        createdAt: '2026-09-02T06:59:01.000Z',
      },
      {
        id: 2,
        eventType: 'SCENARIO_WORKER_STOPPED',
        payload: {
          requests: 4,
          successes: 3,
          failures: 0,
          timeouts: 0,
          inFlight: 0,
          stopReason: 'SMOKE_COMPLETE',
          averageLatencyMs: 15,
          p50LatencyMs: 14,
          p95LatencyMs: 16,
          p99LatencyMs: 16,
          cacheResults: { CACHE_HIT: 3 },
        },
        createdAt: '2026-09-02T06:59:02.000Z',
      },
      {
        id: 3,
        eventType: 'RECOVERY_COMPLETED',
        payload: {
          result: { code: 200, data: { code: 200, data: { faultRunId, hashRemoved: true, released: true, markerRemoved: false } } },
          workerDrain: {
            registered: true,
            drained: true,
            result: {
              requests: 4,
              successes: 3,
              failures: 0,
              timeouts: 0,
              inFlight: 0,
              stopReason: 'COORDINATOR_RECOVERY',
              averageLatencyMs: 15,
              p50LatencyMs: 14,
              p95LatencyMs: 16,
              p99LatencyMs: 16,
              cacheResults: { CACHE_HIT: 3 },
            },
          },
        },
        createdAt: '2026-09-02T06:59:03.000Z',
      },
    ],
    audit: {
      id: 7,
      operatorId: 3,
      action: 'FAULT_RUN_CREATE',
      target: 'CATALOG_REDIS_LARGE_VALUE',
      result: 'SUCCESS',
      createdAt: '2026-09-02T06:59:00.000Z',
    },
    audits: [],
  };

  const view = buildFaultRunView(details);
  assert.equal(view.targetSummary?.memberCount, 2);
  assert.equal(view.targetSummary?.observedBytes, 2848);
  assert.equal(view.workerStats?.cacheResults.CACHE_HIT, 3);
  assert.equal(view.drain?.drained, true);
  assert.equal(view.cleanup?.hashRemoved, true);
  assert.equal(view.markerState, 'RELEASED');
});

test('event summaries do not expose raw error payloads', () => {
  const summary = summarizeFaultRunEvent({
    id: 1,
    eventType: 'SCENARIO_REQUEST_FAILED',
    payload: { timeout: false, error: 'database password should not render' },
    createdAt: '2026-09-02T06:59:01.000Z',
  });
  assert.equal(summary, 'A reader request failed');
  assert.equal(summary.includes('password'), false);
});

test('prefers recovery cleanup over an idempotent manual cleanup result', () => {
  const view = buildFaultRunView({
    run: {
      faultRunId,
      scenario: 'CATALOG_REDIS_LARGE_VALUE',
      targetService: 'catalog-service',
      targetOperation: 'product-detail-cache',
      state: 'STOPPED',
      parameters: {},
      expiresAt: '2026-09-02T07:00:00.000Z',
      createdAt: '2026-09-02T06:59:00.000Z',
      recovery: { kind: 'ABSENT', projection: null },
      manualCleanup: 'UNAVAILABLE',
    },
    events: [
      {
        id: 1,
        eventType: 'RECOVERY_COMPLETED',
        payload: {
          code: 200,
          data: {
            code: 200,
            data: { released: true, hashRemoved: true, markerRemoved: true },
          },
          workerDrain: { registered: false, drained: true },
        },
        createdAt: '2026-09-02T06:59:01.000Z',
      },
      {
        id: 2,
        eventType: 'MANUAL_CLEANUP_COMPLETED',
        payload: {
          result: { released: true, hashRemoved: false, markerRemoved: false },
        },
        createdAt: '2026-09-02T06:59:02.000Z',
      },
    ],
    audits: [],
  });

  assert.equal(view.cleanup?.hashRemoved, true);
  assert.equal(view.cleanup?.markerRemoved, true);
});

test('uses the caller locale translator and safely falls back for unknown events', () => {
  const translate = (key: string) => `zh:${key}`;
  const translated = summarizeFaultRunEvent({
    id: 1,
    eventType: 'TARGET_CONFIRMED',
    payload: {},
    createdAt: '2026-09-02T06:59:01.000Z',
  }, translate);
  const unknown = summarizeFaultRunEvent({
    id: 2,
    eventType: 'UNTRUSTED_EVENT',
    payload: { password: 'must not render' },
    createdAt: '2026-09-02T06:59:02.000Z',
  }, translate);

  assert.equal(translated, 'zh:targetAccepted');
  assert.equal(unknown, 'zh:recordedEvent');
  assert.equal(unknown.includes('password'), false);
});

test('uses the server-derived recovery view for manual cleanup and notification restart actions', () => {
  const manualCleanup = createManualCleanupProjection();
  const cleanupRun: FaultRun = {
    faultRunId,
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    state: 'RECOVERING',
    parameters: { durationSec: 60 },
    expiresAt: '2026-09-18T00:10:00.000Z',
    stoppedAt: null,
    stopReason: 'MANUAL',
    recovery: { kind: 'SAFE_RUNTIME_V1', projection: manualCleanup },
    manualCleanup: 'SAFE_COMMAND',
    createdAt: '2026-09-18T00:00:00.000Z',
  };
  const unavailable = createInitialFaultRunRecoveryProjection({
    reason: 'SERVICE_UNAVAILABLE',
    requestedAt: '2026-09-18T00:00:00.000Z',
    drainDeadlineAt: '2026-09-18T00:00:30.000Z',
    recoveryDeadlineAt: '2026-09-18T00:01:00.000Z',
  });
  const unavailableRun: FaultRun = {
    ...cleanupRun,
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    targetOperation: 'notification-retention',
    recovery: { kind: 'SAFE_RUNTIME_V1', projection: unavailable },
    manualCleanup: 'UNAVAILABLE',
  };

  assert.equal(isManualCleanupAvailable(cleanupRun), true);
  assert.equal(isManualCleanupAvailable({
    ...cleanupRun,
    manualCleanup: 'UNAVAILABLE',
  }), false);
  assert.equal(isManualCleanupAvailable({
    ...cleanupRun,
    manualCleanup: 'LEGACY_TERMINAL',
    state: 'STOPPED',
    recovery: { kind: 'LEGACY', projection: null },
  }), true);
  assert.equal(requiresNotificationServiceRecovery(unavailableRun), true);
  assert.equal(requiresNotificationServiceRecovery({
    ...unavailableRun,
    recovery: { kind: 'UNKNOWN', projection: null, reason: 'INVALID_SHAPE' },
  }), false);
});

function createManualCleanupProjection(): FaultRunRecoveryProjection {
  const initial = createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt: '2026-09-18T00:00:00.000Z',
    drainDeadlineAt: '2026-09-18T00:00:30.000Z',
    recoveryDeadlineAt: '2026-09-18T00:01:00.000Z',
  });
  return {
    ...initial,
    phase: 'MANUAL_CLEANUP_REQUIRED',
    outcome: 'MANUAL_CLEANUP_REQUIRED',
    drain: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: '2026-09-18T00:00:00.000Z',
      completedAt: '2026-09-18T00:00:01.000Z',
      participantKinds: ['RUNNER'],
    },
    release: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: '2026-09-18T00:00:01.000Z',
      completedAt: '2026-09-18T00:00:02.000Z',
    },
    cleanup: {
      status: 'MANUAL_REQUIRED',
      attempt: 0,
      errorCode: 'MANUAL_CLEANUP_REQUIRED',
    },
    residuals: [{
      kind: 'MANUAL_CLEANUP_PENDING',
      responsibility: 'OPERATOR',
      nextAction: 'COMPLETE_MANUAL_CLEANUP',
    }],
    lastError: {
      stage: 'CLEANUP',
      code: 'MANUAL_CLEANUP_REQUIRED',
      retryable: false,
    },
  };
}