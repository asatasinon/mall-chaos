import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FaultRunEventContractError,
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
