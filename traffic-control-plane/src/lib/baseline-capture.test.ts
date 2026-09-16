import assert from 'node:assert/strict';
import test from 'node:test';
import type { BaselineMetadata, BaselineWarmupMetadata } from './baseline-metadata';
import type { ScenarioBaseline } from './baseline-schema';
import type { FaultRunEventRecord, FaultRunRecord } from './fault-run-repository';
import { captureScenarioBaseline } from './baseline-capture';
import type { BaselineRepository } from './baseline-repository';

const sourceFaultRunId = '123e4567-e89b-12d3-a456-426614174000';
const run: FaultRunRecord = {
  faultRunId: sourceFaultRunId,
  scenario: 'BROWSE_SURGE',
  targetService: 'catalog-service',
  targetOperation: 'browse-api-worker',
  state: 'RECOVERED',
  parameters: { durationSec: 60, concurrency: 4 },
  idempotencyKey: 'baseline-capture-test',
  fencingToken: 1,
  startedAt: '2026-09-16T10:00:01.000Z',
  expiresAt: '2026-09-16T10:01:01.000Z',
  stoppedAt: '2026-09-16T10:01:02.000Z',
  stopReason: 'EXPIRED',
  recoveryResult: { released: true },
  recoveryError: null,
  operatorAuditId: 9,
  traceId: 'trace-1',
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T10:01:02.000Z',
};

const events: FaultRunEventRecord[] = [
  { id: 1, faultRunId: sourceFaultRunId, eventType: 'CREATED', payload: {}, createdAt: '2026-09-16T10:00:00.000Z' },
  { id: 2, faultRunId: sourceFaultRunId, eventType: 'TARGET_CONFIRMED', payload: {}, createdAt: '2026-09-16T10:00:01.000Z' },
  {
    id: 3,
    faultRunId: sourceFaultRunId,
    eventType: 'SCENARIO_WORKER_STOPPED',
    payload: {
      requests: 2, successes: 2, failures: 0, timeouts: 0, inFlight: 0,
      averageLatencyMs: 12, p50LatencyMs: 12, p95LatencyMs: 12, p99LatencyMs: 12,
    },
    createdAt: '2026-09-16T10:01:00.000Z',
  },
  { id: 4, faultRunId: sourceFaultRunId, eventType: 'RECOVERY_STARTED', payload: {}, createdAt: '2026-09-16T10:01:01.000Z' },
  { id: 5, faultRunId: sourceFaultRunId, eventType: 'RECOVERY_COMPLETED', payload: {}, createdAt: '2026-09-16T10:01:02.000Z' },
];

const metadata: BaselineMetadata = {
  catalogRevision: 'catalog-revision',
  releaseRevision: 'UNKNOWN',
  deploymentMode: 'compose',
  schemaRevision: 'baseline.v1',
  limitations: ['RELEASE_REVISION_UNKNOWN'],
};

const warmupMetadata: BaselineWarmupMetadata = {
  dataWarmupEnabled: null,
  config: null,
  observedProgress: [],
  limitations: ['DATA_WARMUP_CONFIG_UNAVAILABLE'],
};

class MemoryBaselineRepository implements BaselineRepository {
  baseline: ScenarioBaseline | null = null;

  async findBySourceFaultRunId() {
    return this.baseline;
  }

  async save(baseline: ScenarioBaseline) {
    if (this.baseline) return { baseline: this.baseline, created: false };
    this.baseline = baseline;
    return { baseline, created: true };
  }
}

function dependencies(repository: MemoryBaselineRepository, eventTypes: string[]) {
  return {
    repository,
    loadRun: async () => run,
    loadEvents: async () => events,
    loadAudit: async () => ({
      id: 9,
      operatorId: 1,
      action: 'FAULT_RUN_CREATE',
      target: run.scenario,
      parameterHash: 'hash',
      result: 'SUCCESS' as const,
      correlationId: 'trace-1',
      createdAt: run.createdAt,
    }),
    loadMetadata: () => metadata,
    loadWarmupMetadata: async () => warmupMetadata,
    appendEvent: async (_runId: string, eventType: string) => { eventTypes.push(eventType); },
    now: () => new Date('2026-09-16T10:02:00.000Z'),
    createBaselineId: () => 'baseline-id',
    captureEnabled: () => true,
  };
}

test('captures a limitation-aware baseline and returns the existing row idempotently', async () => {
  const repository = new MemoryBaselineRepository();
  const eventTypes: string[] = [];
  const first = await captureScenarioBaseline(
    sourceFaultRunId,
    {},
    dependencies(repository, eventTypes),
  );
  const second = await captureScenarioBaseline(
    sourceFaultRunId,
    {},
    dependencies(repository, eventTypes),
  );

  assert.equal(first.created, true);
  assert.equal(first.baseline.baselineId, 'baseline-id');
  assert.equal(first.baseline.captureStatus, 'COMPLETE_WITH_LIMITATIONS');
  assert.equal(first.baseline.dataWarmupEnabled, null);
  assert.equal(first.baseline.observationSummary.prometheus.status, 'UNKNOWN');
  assert.equal(first.baseline.outcome.resourceCleanup, 'UNKNOWN');
  assert.equal(second.created, false);
  assert.equal(second.baseline.baselineId, first.baseline.baselineId);
  assert.deepEqual(eventTypes, [
    'BASELINE_CAPTURE_REQUESTED',
    'BASELINE_RUNTIME_SUMMARY_RECORDED',
    'BASELINE_OBSERVATION_CHECK_RECORDED',
    'BASELINE_CAPTURE_COMPLETED',
  ]);
});

test('does not create a baseline for a non-terminal run or when capture is disabled', async () => {
  const repository = new MemoryBaselineRepository();
  await assert.rejects(
    () => captureScenarioBaseline(
      sourceFaultRunId,
      {},
      { ...dependencies(repository, []), loadRun: async () => ({ ...run, state: 'ACTIVE' as const }) },
    ),
    (error: unknown) => error instanceof Error && error.message === 'RUN_NOT_TERMINAL',
  );
  await assert.rejects(
    () => captureScenarioBaseline(
      sourceFaultRunId,
      {},
      { ...dependencies(repository, []), captureEnabled: () => false },
    ),
    (error: unknown) => error instanceof Error && error.message === 'BASELINE_CAPTURE_DISABLED',
  );
});
