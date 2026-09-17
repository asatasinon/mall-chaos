import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FaultRunEventContractError,
  normalizeBaselineCaptureEventPayload,
  normalizeFaultRunSummaryEventPayload,
} from './fault-run-event-contract';

test('normalizes scenario worker summaries to bounded low-cardinality payloads', () => {
  const payload = normalizeFaultRunSummaryEventPayload('SCENARIO_WORKER_DRAINED', {
    requests: 10,
    successes: 9,
    failures: 1,
    timeouts: 1,
    inFlight: 0,
    averageLatencyMs: 20,
    p50LatencyMs: 10,
    p95LatencyMs: 40,
    p99LatencyMs: 60,
    stopReason: 'COORDINATOR_RECOVERY',
    cacheResults: {
      CACHE_HIT: 9,
      CACHE_MISS_DB_FALLBACK: 0,
      CACHE_INVALID_FALLBACK: 0,
      CACHE_BACKEND_ERROR: 0,
      CACHE_UNKNOWN: 0,
    },
    error: 'this is intentionally discarded',
    faultRunId: 'not copied',
  });

  assert.deepEqual(payload, {
    schemaVersion: 1,
    source: 'scenario-worker',
    phase: 'recovery',
    status: 'DRAINED',
    requests: 10,
    successes: 9,
    failures: 1,
    timeouts: 1,
    inFlight: 0,
    averageLatencyMs: 20,
    p50LatencyMs: 10,
    p95LatencyMs: 40,
    p99LatencyMs: 60,
    stopReason: 'COORDINATOR_RECOVERY',
    cacheResults: {
      CACHE_HIT: 9,
      CACHE_MISS_DB_FALLBACK: 0,
      CACHE_INVALID_FALLBACK: 0,
      CACHE_BACKEND_ERROR: 0,
      CACHE_UNKNOWN: 0,
    },
  });
});

test('normalizes scenario worker start and request failure events without raw errors', () => {
  assert.deepEqual(
    normalizeFaultRunSummaryEventPayload('SCENARIO_WORKER_STARTED', {
      concurrency: 2,
      requestIntervalMs: 100,
      scenario: 'CART_CATALOG_DEPENDENCY',
    }),
    {
      schemaVersion: 1,
      source: 'scenario-worker',
      phase: 'worker',
      status: 'STARTED',
      concurrency: 2,
      requestIntervalMs: 100,
    },
  );
  assert.deepEqual(
    normalizeFaultRunSummaryEventPayload('SCENARIO_REQUEST_FAILED', {
      error: 'raw downstream response',
      errorCode: 'raw-error',
      timeout: true,
      cacheResult: 'CACHE_BACKEND_ERROR',
    }),
    {
      schemaVersion: 1,
      source: 'scenario-worker',
      phase: 'effect',
      status: 'FAILED',
      failureCode: 'WORKER_REQUEST_FAILED',
      timeout: true,
      cacheResult: 'CACHE_BACKEND_ERROR',
    },
  );
});

test('keeps runner result status while normalizing unknown error codes', () => {
  const payload = normalizeFaultRunSummaryEventPayload('RUNNER_LIFECYCLE_SUMMARY', {
    status: 'FAILED',
    success: false,
    latencyMs: 150,
    errorCode: 'raw-error-text',
    lifecycleId: 'not copied',
  });

  assert.deepEqual(payload, {
    schemaVersion: 1,
    source: 'runner',
    phase: 'effect',
    status: 'COMPLETED',
    resultStatus: 'FAILED',
    success: false,
    latencyMs: 150,
  });
});

test('rejects unsupported summary events and preserves a strict payload bound', () => {
  assert.throws(
    () => normalizeFaultRunSummaryEventPayload('UNKNOWN_EVENT', {}),
    (error: unknown) => error instanceof FaultRunEventContractError
      && error.message === 'UNSUPPORTED_SUMMARY_EVENT:UNKNOWN_EVENT',
  );
  assert.doesNotThrow(() => normalizeFaultRunSummaryEventPayload('REPORT_WORKER_STOPPED', {
    requests: 1,
    successes: 1,
    failures: 0,
    averageLatencyMs: 1,
    reason: 'EXPIRED_OR_STOPPED',
    oversized: 'x'.repeat(100_000),
  }));
});

test('normalizes observation status and window fields without query details', () => {
  assert.deepEqual(
    normalizeBaselineCaptureEventPayload('BASELINE_OBSERVATION_CHECK_RECORDED', {
      limitationCount: 2,
      prometheusStatus: 'AVAILABLE',
      lokiStatus: 'PARTIAL',
      tempoStatus: 'UNKNOWN',
      retentionStatus: 'CHECKED',
      windowStart: '2026-09-16T10:00:00.000Z',
      windowEnd: '2026-09-16T10:05:00.000Z',
      query: 'raw query must not be copied',
    }),
    {
      schemaVersion: 1,
      source: 'coordinator',
      phase: 'effect',
      status: 'UNKNOWN',
      limitationCount: 2,
      prometheusStatus: 'AVAILABLE',
      lokiStatus: 'PARTIAL',
      tempoStatus: 'UNKNOWN',
      retentionStatus: 'CHECKED',
      windowStart: '2026-09-16T10:00:00.000Z',
      windowEnd: '2026-09-16T10:05:00.000Z',
    },
  );
});
