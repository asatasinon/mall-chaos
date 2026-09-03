import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFaultRunView, summarizeFaultRunEvent } from './fault-run-view';
import type { FaultRunDetails } from './types';

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
      recoveryResult: null,
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
      parameterHash: 'hash-only',
      result: 'SUCCESS',
      correlationId: 'trace-only',
      createdAt: '2026-09-02T06:59:00.000Z',
    },
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
      recoveryResult: null,
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