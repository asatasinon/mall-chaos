import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBaselineSourceRun, BaselineCaptureError } from './baseline-capture-errors';
import { listScenarioDefinitions } from './fault-run-catalog';
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

test('folds every Catalog scenario through a runtime source matrix without copying Catalog facts', () => {
  const sourceKinds = new Set<string>();

  for (const definition of listScenarioDefinitions()) {
    const scenarioRun = {
      ...run,
      scenario: definition.scenario,
      targetService: definition.targetService,
      targetOperation: definition.targetOperation,
      state: 'RECOVERED' as const,
    };
    const folded = foldBaselineEvents(scenarioRun, [
      event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
      event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
      event(3, 'REPORT_REQUEST', '2026-09-16T10:00:20.000Z', {
        requests: 2,
        successes: 1,
        failures: 1,
        latencyMs: 20,
      }),
      event(4, 'REPORT_WORKER_STOPPED', '2026-09-16T10:00:21.000Z', {
        requests: 2,
        successes: 1,
        failures: 1,
        averageLatencyMs: 20,
      }),
      event(5, 'SCENARIO_WORKER_STARTED', '2026-09-16T10:00:22.000Z'),
      event(6, 'SCENARIO_WORKER_STOPPED', '2026-09-16T10:00:23.000Z', {
        requests: 3,
        successes: 2,
        failures: 1,
        timeouts: 0,
        inFlight: 0,
        averageLatencyMs: 30,
        p50LatencyMs: 20,
        p95LatencyMs: 40,
        p99LatencyMs: 50,
      }),
      event(7, 'RUNNER_LIFECYCLE_SUMMARY', '2026-09-16T10:00:24.000Z', {
        status: 'SUCCESS',
        success: true,
        latencyMs: 30,
      }),
      event(8, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
      event(9, 'RECOVERY_COMPLETED', '2026-09-16T10:01:02.000Z'),
      event(10, 'SERVICE_RECOVERED', '2026-09-16T10:01:03.000Z'),
    ]);

    assert.equal(folded.lifecycle.prepareStartedAt, '2026-09-16T10:00:00.000Z');
    assert.equal(folded.lifecycle.activeAt, '2026-09-16T10:00:01.000Z');
    assert.equal(folded.lifecycle.stopRequestedAt, '2026-09-16T10:01:01.000Z');
    assert.equal(folded.lifecycle.recoveredAt, '2026-09-16T10:01:02.000Z');
    assert.equal(
      folded.lifecycle.cleanupFinishedAt,
      definition.recoveryStrategy === 'NON_RELEASING'
        ? null : '2026-09-16T10:01:02.000Z',
    );
    assert.ok(folded.eventSources.some((source) =>
      ['REPORT_WORKER_STOPPED', 'SCENARIO_WORKER_STOPPED', 'RUNNER_LIFECYCLE_SUMMARY']
        .includes(source.eventType)));

    if (folded.requestSummary?.requests === 2) {
      sourceKinds.add('REPORT');
      assert.equal(folded.requestSummary.successes, 1);
      assert.equal(folded.requestSummary.failures, 1);
    } else if (folded.requestSummary?.requests === 3) {
      sourceKinds.add('SCENARIO');
      assert.equal(folded.requestSummary.successes, 2);
      assert.equal(folded.requestSummary.failures, 1);
    } else {
      sourceKinds.add('RUNNER');
      assert.equal(folded.requestSummary?.requests, null);
      assert.equal(folded.requestSummary?.successes, 1);
    }

    assert.equal(folded.outcome.businessRecovered, 'YES');
    assert.equal(
      folded.outcome.resourceCleanup,
      definition.recoveryStrategy === 'NON_RELEASING'
        ? 'NOT_REQUIRED'
        : definition.recoveryStrategy === 'MANUAL_CLEANUP' ? 'MANUAL_REQUIRED' : 'UNKNOWN',
    );
  }

  assert.deepEqual([...sourceKinds].sort(), ['REPORT', 'RUNNER', 'SCENARIO']);
});

test('preserves recovery and cleanup integrity for every Catalog recovery strategy', () => {
  const definitionsByStrategy = new Map<string, ReturnType<typeof listScenarioDefinitions>[number]>();
  for (const definition of listScenarioDefinitions()) {
    if (!definitionsByStrategy.has(definition.recoveryStrategy)) {
      definitionsByStrategy.set(definition.recoveryStrategy, definition);
    }
  }

  for (const strategy of ['TARGET', 'WORKER', 'MANUAL_CLEANUP', 'NON_RELEASING']) {
    const definition = definitionsByStrategy.get(strategy);
    if (!definition) throw new Error(`MISSING_STRATEGY_FIXTURE:${strategy}`);
    const scenarioRun = {
      ...run,
      scenario: definition.scenario,
      targetService: definition.targetService,
      targetOperation: definition.targetOperation,
      state: 'RECOVERED' as const,
    };
    const commonEvents = [
      event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
      event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
      event(3, 'REPORT_REQUEST', '2026-09-16T10:00:20.000Z', {
        requests: 1, successes: 1, failures: 0, latencyMs: 20,
      }),
      event(4, 'REPORT_WORKER_STOPPED', '2026-09-16T10:00:21.000Z', {
        requests: 1, successes: 1, failures: 0, averageLatencyMs: 20,
      }),
      event(5, 'SCENARIO_WORKER_STOPPED', '2026-09-16T10:00:22.000Z', {
        requests: 1, successes: 1, failures: 0, timeouts: 0, inFlight: 0,
        averageLatencyMs: 20, p50LatencyMs: 20, p95LatencyMs: 20, p99LatencyMs: 20,
      }),
      event(6, 'RUNNER_LIFECYCLE_SUMMARY', '2026-09-16T10:00:23.000Z', {
        status: 'SUCCESS', success: true, latencyMs: 20,
      }),
      event(7, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
      event(8, 'RECOVERY_COMPLETED', '2026-09-16T10:01:02.000Z'),
    ];
    const folded = foldBaselineEvents(scenarioRun, commonEvents);

    assert.equal(folded.outcome.businessRecovered, 'UNKNOWN');
    if (strategy === 'TARGET' || strategy === 'WORKER') {
      assert.equal(folded.outcome.resourceCleanup, 'UNKNOWN');
      assert.equal(folded.lifecycle.cleanupFinishedAt, '2026-09-16T10:01:02.000Z');
      assert.ok(folded.knownLimitations.some((item) => item.code === 'CLEANUP_UNVERIFIED'));
    } else if (strategy === 'MANUAL_CLEANUP') {
      assert.equal(folded.outcome.resourceCleanup, 'MANUAL_REQUIRED');
      assert.ok(folded.outcome.failureClasses.includes('CLEANUP_FAILURE'));
      assert.ok(folded.knownLimitations.some((item) => item.code === 'MANUAL_CLEANUP_REQUIRED'));

      const completed = foldBaselineEvents(scenarioRun, [
        ...commonEvents,
        event(9, 'MANUAL_CLEANUP_COMPLETED', '2026-09-16T10:01:04.000Z'),
        event(10, 'SERVICE_RECOVERED', '2026-09-16T10:01:05.000Z'),
      ]);
      assert.equal(completed.outcome.resourceCleanup, 'COMPLETED');
      assert.equal(completed.outcome.businessRecovered, 'YES');
      assert.equal(completed.lifecycle.cleanupFinishedAt, '2026-09-16T10:01:04.000Z');

      const failedCleanup = foldBaselineEvents(scenarioRun, [
        ...commonEvents,
        event(9, 'MANUAL_CLEANUP_FAILED', '2026-09-16T10:01:04.000Z'),
      ]);
      assert.equal(failedCleanup.outcome.resourceCleanup, 'FAILED');
      assert.ok(failedCleanup.outcome.failureClasses.includes('CLEANUP_FAILURE'));
    } else {
      assert.equal(folded.outcome.resourceCleanup, 'NOT_REQUIRED');
      assert.equal(folded.lifecycle.cleanupFinishedAt, null);
      assert.ok(folded.knownLimitations.some((item) =>
        item.code === 'NON_RELEASING_RESOURCE_BOUNDARY'));
    }
  }

  const targetDefinition = definitionsByStrategy.get('TARGET');
  if (!targetDefinition) throw new Error('MISSING_STRATEGY_FIXTURE:TARGET');
  const failedRun = {
    ...run,
    scenario: targetDefinition.scenario,
    targetService: targetDefinition.targetService,
    targetOperation: targetDefinition.targetOperation,
    state: 'FAILED' as const,
  };
  const failed = foldBaselineEvents(failedRun, [
    event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
    event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
    event(3, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
    event(4, 'RECOVERY_FAILED', '2026-09-16T10:01:02.000Z'),
  ]);
  assert.equal(failed.outcome.businessRecovered, 'NO');
  assert.equal(failed.outcome.resourceCleanup, 'FAILED');
  assert.ok(failed.outcome.failureClasses.includes('RECOVERY_FAILURE'));
});

test('keeps missing worker terminal events and stable worker failure codes visible', () => {
  const folded = foldBaselineEvents(run, [
    event(1, 'CREATED', '2026-09-16T10:00:00.000Z'),
    event(2, 'TARGET_CONFIRMED', '2026-09-16T10:00:01.000Z'),
    event(3, 'SCENARIO_WORKER_STARTED', '2026-09-16T10:00:02.000Z'),
    event(4, 'SCENARIO_REQUEST_FAILED', '2026-09-16T10:00:30.000Z', {
      errorCode: 'untrusted-error-text',
    }),
    event(5, 'SCENARIO_WORKER_DRAINED', '2026-09-16T10:01:00.000Z', {
      requests: 1,
      successes: 0,
      failures: 1,
      timeouts: 0,
      inFlight: 0,
    }),
    event(6, 'RECOVERY_STARTED', '2026-09-16T10:01:01.000Z'),
    event(7, 'RECOVERY_COMPLETED', '2026-09-16T10:01:02.000Z'),
  ]);

  assert.equal(folded.status, 'INCOMPLETE');
  assert.equal(folded.requestSummary?.requests, 1);
  assert.equal(folded.outcome.effectObserved, 'OBSERVED');
  assert.deepEqual(folded.outcome.failureCodes, ['WORKER_REQUEST_FAILED']);
  assert.ok(folded.knownLimitations.some((item) =>
    item.code === 'MISSING_RUNTIME_EVENT' && item.detail === 'SCENARIO_WORKER_STOPPED'));
});
