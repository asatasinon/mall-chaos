import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBaselineSourceRun, BaselineCaptureError } from './baseline-capture-errors';
import type { FaultRunEventRecord, FaultRunRecord } from './fault-run-repository';
import { foldBaselineEvents } from './baseline-event-folding';

const run: FaultRunRecord = {
  faultRunId: '123e4567-e89b-12d3-a456-426614174000',
  scenario: 'BROWSE_SURGE',
  targetService: 'catalog-service',
  targetOperation: 'browse-api-worker',
  state: 'RECOVERED',
  parameters: { durationSec: 60, concurrency: 4 },
  idempotencyKey: 'browse-surge-test-1234',
  fencingToken: 1,
  startedAt: '2026-09-16T10:00:01.000Z',
  expiresAt: '2026-09-16T10:01:01.000Z',
  stoppedAt: '2026-09-16T10:01:02.000Z',
  stopReason: 'EXPIRED',
  recoveryResult: { released: true },
  recoveryError: null,
  operatorAuditId: 1,
  traceId: 'trace-1',
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T10:01:02.000Z',
};

function event(
  id: number,
  eventType: string,
  createdAt: string,
  payload: unknown = {},
): FaultRunEventRecord {
  return { id, faultRunId: run.faultRunId, eventType, payload, createdAt };
}

test('folds a complete controlled-worker run deterministically by timestamp and id', () => {
  const events = [
    event(5, 'RECOVERY_COMPLETED', '2026-09-16T10:01:02.000Z', { released: true }),
    event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
    event(4, 'SCENARIO_WORKER_STOPPED', '2026-09-16T10:01:00.000Z', {
      requests: 10,
      successes: 8,
      failures: 2,
      timeouts: 1,
      inFlight: 0,
      averageLatencyMs: 20,
      p50LatencyMs: 10,
      p95LatencyMs: 40,
      p99LatencyMs: 60,
    }),
    event(3, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
    event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
    event(6, 'SERVICE_RECOVERED', '2026-09-16T10:01:02.000Z'),
  ];

  const folded = foldBaselineEvents(run, events);

  assert.equal(folded.status, 'COMPLETE_WITH_LIMITATIONS');
  assert.deepEqual(folded.lifecycle, {
    prepareStartedAt: '2026-09-16T10:00:00.000Z',
    activeAt: '2026-09-16T10:00:01.000Z',
    stopRequestedAt: '2026-09-16T10:01:01.000Z',
    recoveredAt: '2026-09-16T10:01:02.000Z',
    cleanupFinishedAt: '2026-09-16T10:01:02.000Z',
  });
  assert.equal(folded.outcome.effectObserved, 'OBSERVED');
  assert.equal(folded.outcome.businessRecovered, 'YES');
  assert.equal(folded.requestSummary?.requests, 10);
  assert.deepEqual(folded.eventSources.map((source) => source.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(folded.knownLimitations.some((item) => item.code === 'CLEANUP_UNVERIFIED'), true);
});

test('keeps report counters and marks a missing terminal worker event incomplete', () => {
  const reportRun = { ...run, scenario: 'ORDER_REPORT_SQL' as const };
  const folded = foldBaselineEvents(reportRun, [
    event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
    event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
    event(3, 'REPORT_REQUEST', '2026-09-16T10:00:20.000Z', {
      requests: 3,
      successes: 2,
      failures: 1,
      latencyMs: 40,
    }),
    event(4, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
    event(5, 'RECOVERY_COMPLETED', '2026-09-16T10:01:02.000Z'),
  ]);

  assert.equal(folded.status, 'INCOMPLETE');
  assert.deepEqual(folded.requestSummary, {
    requests: 3,
    successes: 2,
    failures: 1,
    timeouts: null,
    averageLatencyMs: null,
    p50LatencyMs: null,
    p95LatencyMs: null,
    p99LatencyMs: null,
  });
  assert.equal(folded.knownLimitations.some((item) =>
    item.code === 'MISSING_RUNTIME_EVENT' && item.detail === 'REPORT_WORKER_STOPPED'), true);
});

test('does not repair inconsistent counters and blocks completion', () => {
  const folded = foldBaselineEvents(run, [
    event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
    event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
    event(3, 'SCENARIO_WORKER_STOPPED', '2026-09-16T10:01:00.000Z', {
      requests: 5,
      successes: 5,
      failures: 1,
      timeouts: 0,
      inFlight: 0,
    }),
    event(4, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
    event(5, 'RECOVERY_COMPLETED', '2026-09-16T10:01:02.000Z'),
  ]);

  assert.equal(folded.status, 'INCOMPLETE');
  assert.equal(folded.requestSummary?.requests, 5);
  assert.equal(folded.requestSummary?.failures, 1);
  assert.equal(folded.knownLimitations.some((item) => item.code === 'COUNTER_INCONSISTENT'), true);
});

test('blocks CART catalog dependency without verified runtime dispatch', () => {
  const cartRun = { ...run, scenario: 'CART_CATALOG_DEPENDENCY' as const };
  const folded = foldBaselineEvents(cartRun, [
    event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
    event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
    event(3, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
    event(4, 'RECOVERY_COMPLETED', '2026-09-16T10:01:02.000Z'),
  ]);

  assert.equal(folded.status, 'INCOMPLETE');
  assert.equal(folded.requestSummary, null);
  assert.equal(folded.outcome.effectObserved, 'UNKNOWN');
  assert.equal(folded.knownLimitations.some((item) => item.code === 'DISPATCH_UNVERIFIED'), true);
});

test('marks non-releasing resources explicitly instead of claiming cleanup', () => {
  const heapRun = { ...run, scenario: 'NOTIFICATION_HEAP_PRESSURE' as const };
  const folded = foldBaselineEvents(heapRun, [
    event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
    event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
    event(3, 'RUNNER_LIFECYCLE_SUMMARY', '2026-09-16T10:00:30.000Z', {
      status: 'SUCCESS',
      success: true,
      latencyMs: 25,
    }),
    event(4, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
    event(5, 'RECOVERY_COMPLETED', '2026-09-16T10:01:02.000Z'),
  ]);

  assert.equal(folded.outcome.resourceCleanup, 'NOT_REQUIRED');
  assert.equal(folded.knownLimitations.some((item) =>
    item.code === 'NON_RELEASING_RESOURCE_BOUNDARY'), true);
  assert.equal(folded.requestSummary?.requests, null);
});

test('uses stable capture errors for missing and non-terminal source runs', () => {
  assert.throws(
    () => assertBaselineSourceRun(null),
    (error: unknown) => error instanceof BaselineCaptureError
      && error.code === 'SOURCE_RUN_NOT_FOUND'
      && error.status === 404,
  );
  assert.throws(
    () => assertBaselineSourceRun({ state: 'ACTIVE' }),
    (error: unknown) => error instanceof BaselineCaptureError
      && error.code === 'RUN_NOT_TERMINAL'
      && error.status === 409,
  );
});
