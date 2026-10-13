import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import {
  createEvidenceManifestDraft,
} from './evidence-manifest-materializer';
import {
  computeRangeStepSeconds,
  type EvidenceQueryClientResponse,
  type EvidenceQueryRange,
  type MetricRangeResult,
} from './evidence-query-clients';
import {
  createEvidenceCaptureSnapshot,
  canonicalizeEvidenceRenderedRecipes,
  getEvidenceManifestHash,
  parseEvidenceManifest,
  parseEvidenceStoredContractSnapshot,
  type EvidenceManifestRecord,
  type EvidenceStoredContractSnapshotRecord,
  type RenderedEvidenceRecipe,
} from './evidence-types';
import { EvidenceReportService, EvidenceReportServiceError } from './evidence-report-service';
import { parseEvidenceWebConfig } from './evidence-web-config';
import type { CompleteEvidenceAttemptInput } from './evidence-repository';
import { getScenarioContractRevision, resolveScenarioContract } from './scenario-contract';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';

const DATABASE_NOW = '2026-10-09T06:00:00.000Z';

test('executes only the frozen plan and returns bounded summaries without raw samples', async () => {
  const { manifest, snapshot } = fixture();
  assert.doesNotThrow(() => parseEvidenceManifest(manifest));
  assert.doesNotThrow(() => parseEvidenceStoredContractSnapshot({
    ...snapshot,
    rendererRevision: snapshot.renderedPlan.rendererRevision,
    evaluationRevision: snapshot.renderedPlan.evaluationRevision,
  }));
  assert.equal(
    canonicalizeEvidenceRenderedRecipes(manifest.recipes),
    canonicalizeEvidenceRenderedRecipes(snapshot.renderedPlan.recipes),
  );
  const queries: string[] = [];
  let clockReads = 0;
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(),
    loadDatabaseNow: async () => {
      clockReads += 1;
      return DATABASE_NOW;
    },
    createQueryAdapter: () => ({
      async query(recipe, range) {
        queries.push(`${recipe.source}:${recipe.renderedQuery}`);
        return sourceResult(recipe, range);
      },
    }),
    createBusinessCheckAdapter: () => ({
      async check(recipe, checkedAt) {
        if (!recipe.businessCheckId) throw new Error('business check id missing');
        return {
          source: 'BUSINESS_CHECK',
          recipeId: recipe.recipeId,
          businessCheckId: recipe.businessCheckId,
          status: 'PASS',
          checkedAt,
          reasonCode: null,
        };
      },
    }),
  });

  const result = await service.execute(manifest, snapshot);

  assert.equal(clockReads, 1);
  assert.equal(result.manifestId, manifest.manifestId);
  assert.equal(result.manifestRevision, manifest.manifestRevision);
  assert.equal(result.evaluatedAt, DATABASE_NOW);
  assert.equal(result.items.length, manifest.recipes.length);
  assert.ok(result.items.some(({ source }) => source === 'RUN_EVENT'));
  assert.ok(result.items.some(({ source }) => source === 'BUSINESS_CHECK'));
  assert.ok(result.items.every((item) => !('value' in item) && !('rawResponse' in item)));
  const activeSummary = result.recipeSummaries.find((summary) => summary.window === 'active');
  assert.ok(activeSummary?.summary);
  assert.equal(activeSummary.summary.minimum, 3);
  assert.equal(activeSummary.summary.maximum, 3);
  const comparison = result.baselineComparisons[0];
  assert.equal(comparison?.status, 'AVAILABLE');
  assert.equal(comparison?.delta?.latest, 0);
  assert.ok(queries.every((query) => query !== 'PROMETHEUS:null' && query !== 'TEMPO:null'));
  assert.ok(queries.length > 0);
});

test('complete empty Tempo searches expose zero count context without a delta', async () => {
  const { manifest, snapshot } = fixture('ORDER_QUERY_SURGE');
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(),
    loadDatabaseNow: async () => DATABASE_NOW,
    createQueryAdapter: () => ({
      async query(recipe, range) {
        const result = sourceResult(recipe, range);
        return result.source === 'TEMPO'
          ? { ...result, traceCount: 0, durationsMs: [] }
          : result;
      },
    }),
    createBusinessCheckAdapter: () => ({
      async check(recipe, checkedAt) {
        if (!recipe.businessCheckId) throw new Error('business check id missing');
        return {
          source: 'BUSINESS_CHECK',
          recipeId: recipe.recipeId,
          businessCheckId: recipe.businessCheckId,
          status: 'PASS',
          checkedAt,
          reasonCode: null,
        };
      },
    }),
  });

  const report = await service.execute(manifest, snapshot);
  const tempoComparison = report.baselineComparisons.find(({ source }) => source === 'TEMPO');
  assert.equal(tempoComparison?.status, 'COUNT_CONTEXT_ONLY');
  assert.equal(tempoComparison?.active?.pointCount, 0);
  assert.equal(tempoComparison?.baseline?.latest, 0);
  assert.equal(tempoComparison?.delta, null);
  assert.ok(report.recipeSummaries.filter(({ source }) => source === 'TEMPO')
    .every(({ summary }) => summary?.pointCount === 0));
});

test('query kill switches produce unavailable projections without invoking source adapters', async () => {
  const { manifest, snapshot } = fixture();
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(false),
    loadDatabaseNow: async () => DATABASE_NOW,
    createQueryAdapter: () => ({
      async query() {
        throw new Error('source adapter must not be called while disabled');
      },
    }),
    createBusinessCheckAdapter: () => ({
      async check() {
        throw new Error('Gateway adapter must not be called while disabled');
      },
    }),
  });

  const result = await service.execute(manifest, snapshot);

  assert.equal(result.evidenceStatus, 'EVIDENCE_UNAVAILABLE');
  assert.equal(result.items.filter(({ source }) => source !== 'RUN_EVENT')
    .every(({ reasonCode }) => reasonCode === 'QUERY_EXECUTION_DISABLED'), true);
  assert.equal(result.items.some(({ source }) => source === 'RUN_EVENT'), true);
  assert.ok(result.recipeSummaries.every(({ summary }) => summary === null));
  assert.ok(result.baselineComparisons.every(({ status }) => status !== 'AVAILABLE'));
});

test('a total deadline aborts in-flight work and fills unfinished frozen recipes safely', async () => {
  const { manifest, snapshot } = fixture();
  const service = new EvidenceReportService({
    getConfig: () => ({ ...enabledConfig(), totalTimeoutMs: 25 }),
    loadDatabaseNow: async () => DATABASE_NOW,
    createQueryAdapter: () => ({
      query(_recipe, _range, signal) {
        return new Promise<EvidenceQueryClientResponse>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    }),
    createBusinessCheckAdapter: () => ({
      async check(recipe, checkedAt) {
        if (!recipe.businessCheckId) throw new Error('business check id missing');
        return {
          source: 'BUSINESS_CHECK',
          recipeId: recipe.recipeId,
          businessCheckId: recipe.businessCheckId,
          status: 'PASS',
          checkedAt,
          reasonCode: null,
        };
      },
    }),
  });

  const result = await service.execute(manifest, snapshot);

  assert.equal(result.items.length, manifest.recipes.length);
  assert.ok(result.items.some(({ reasonCode }) => reasonCode === 'REPORT_DEADLINE_EXCEEDED'));
  assert.ok(result.items.every(({ recipeId, window }) =>
    manifest.recipes.some((recipe) => recipe.recipeId === recipeId && recipe.window === window)));
});

test('concurrent reports fail fast at the process limit and source requests stay bounded', async () => {
  const { manifest, snapshot } = fixture();
  const activeBySource = new Map<string, number>();
  const maxBySource = new Map<string, number>();
  let firstQueryStarted!: () => void;
  const queryStarted = new Promise<void>((resolve) => { firstQueryStarted = resolve; });
  const service = new EvidenceReportService({
    getConfig: () => ({ ...enabledConfig(), maxConcurrentReports: 2 }),
    loadDatabaseNow: async () => DATABASE_NOW,
    createQueryAdapter: () => ({
      async query(recipe, range) {
        firstQueryStarted();
        const active = (activeBySource.get(recipe.source) ?? 0) + 1;
        activeBySource.set(recipe.source, active);
        maxBySource.set(recipe.source, Math.max(maxBySource.get(recipe.source) ?? 0, active));
        try {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return sourceResult(recipe, range);
        } finally {
          activeBySource.set(recipe.source, active - 1);
        }
      },
    }),
    createBusinessCheckAdapter: () => ({
      async check(recipe, checkedAt) {
        if (!recipe.businessCheckId) throw new Error('business check id missing');
        return {
          source: 'BUSINESS_CHECK',
          recipeId: recipe.recipeId,
          businessCheckId: recipe.businessCheckId,
          status: 'PASS',
          checkedAt,
          reasonCode: null,
        };
      },
    }),
  });

  const first = service.execute(manifest, snapshot);
  const second = service.execute(manifest, snapshot);
  await queryStarted;
  await assert.rejects(
    service.execute(manifest, snapshot),
    (error: unknown) => error instanceof EvidenceReportServiceError
      && error.code === 'EVIDENCE_REPORT_BUSY',
  );
  await Promise.all([first, second]);
  assert.ok([...maxBySource.values()].every((maximum) => maximum <= 2));
});

test('attempt replay returns metadata without reading a Manifest or querying sources', async () => {
  const { manifest } = fixture();
  let manifestReads = 0;
  let queryCalls = 0;
  const replayAttempt = attemptRecord(manifest, 'COMPLETED');
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(),
    repository: {
      async getReportAttemptByIdempotencyKey() {
        return replayAttempt;
      },
      async createReportAttempt() {
        throw new Error('replay must not create an attempt');
      },
      async completeReportAttempt() {
        throw new Error('replay must not complete an attempt');
      },
      async getManifest() {
        manifestReads += 1;
        throw new Error('replay must not load a Manifest');
      },
      async loadContractSnapshot() {
        throw new Error('replay must not load a snapshot');
      },
    },
    createQueryAdapter: () => ({
      async query() {
        queryCalls += 1;
        throw new Error('replay must not query a source');
      },
    }),
  });

  const result = await service.executeAttempt(attemptInput(manifest));

  assert.equal(result.replayed, true);
  assert.equal(result.report, null);
  assert.equal(result.attempt.attemptId, replayAttempt.attemptId);
  assert.equal(manifestReads, 0);
  assert.equal(queryCalls, 0);
});

test('disabled query execution rejects before creating an attempt or calling dependencies', async () => {
  const { manifest } = fixture();
  let attemptCreations = 0;
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(false),
    repository: {
      async getReportAttemptByIdempotencyKey() {
        throw new Error('disabled query mode must not read idempotency records');
      },
      async createReportAttempt() {
        attemptCreations += 1;
        throw new Error('disabled execution must not create an attempt');
      },
      async completeReportAttempt() {
        throw new Error('disabled execution must not complete an attempt');
      },
      async getManifest() {
        throw new Error('disabled execution must not load a Manifest');
      },
      async loadContractSnapshot() {
        throw new Error('disabled execution must not load a snapshot');
      },
    },
  });

  await assert.rejects(
    service.executeAttempt(attemptInput(manifest)),
    (error: unknown) => error instanceof EvidenceReportServiceError
      && error.code === 'EVIDENCE_REPORT_EXECUTION_DISABLED',
  );
  assert.equal(attemptCreations, 0);
});

test('execution kill switch permits metadata replay but rejects new requests before create', async () => {
  const { manifest } = fixture();
  const existingAttempt = attemptRecord(manifest, 'COMPLETED');
  let lookups = 0;
  let creates = 0;
  const repository = {
    async getReportAttemptByIdempotencyKey() {
      lookups += 1;
      return lookups === 1 ? existingAttempt : null;
    },
    async createReportAttempt() {
      creates += 1;
      throw new Error('disabled execution must not create an attempt');
    },
    async completeReportAttempt() {
      throw new Error('disabled execution must not complete an attempt');
    },
    async getManifest() {
      throw new Error('metadata replay must not load a Manifest');
    },
    async loadContractSnapshot() {
      throw new Error('metadata replay must not load a snapshot');
    },
  };
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(true, false),
    repository,
    createQueryAdapter: () => ({
      async query() {
        throw new Error('disabled execution must not query a source');
      },
    }),
  });

  const replay = await service.executeAttempt(attemptInput(manifest));
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt.attemptId, existingAttempt.attemptId);
  await assert.rejects(
    service.executeAttempt({
      ...attemptInput(manifest),
      idempotencyKey: 'evidence-report-new-key-002',
    }),
    (error: unknown) => error instanceof EvidenceReportServiceError
      && error.code === 'EVIDENCE_REPORT_EXECUTION_DISABLED',
  );
  assert.equal(lookups, 2);
  assert.equal(creates, 0);
});

test('client cancellation settles the running attempt without retrying a source request', async () => {
  const { manifest, snapshot } = fixture();
  const runningAttempt = attemptRecord(manifest, 'RUNNING');
  const completions: CompleteEvidenceAttemptInput[] = [];
  const queryCalls = new Map<string, number>();
  let notifyQueryStarted!: () => void;
  const queryStarted = new Promise<void>((resolve) => { notifyQueryStarted = resolve; });
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(),
    loadDatabaseNow: async () => DATABASE_NOW,
    repository: {
      async getReportAttemptByIdempotencyKey() {
        return null;
      },
      async createReportAttempt() {
        return { attempt: runningAttempt, created: true };
      },
      async completeReportAttempt(input) {
        completions.push(input);
        return {
          ...runningAttempt,
          state: input.state,
          evidenceStatus: input.evidenceStatus,
          failureCode: input.failureCode,
          completedAt: DATABASE_NOW,
          totalDurationMs: input.totalDurationMs,
        };
      },
      async getManifest() {
        return manifest;
      },
      async loadContractSnapshot() {
        return snapshot;
      },
    },
    createQueryAdapter: () => ({
      query(recipe, _range, signal) {
        queryCalls.set(recipe.recipeId, (queryCalls.get(recipe.recipeId) ?? 0) + 1);
        notifyQueryStarted();
        return new Promise<EvidenceQueryClientResponse>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    }),
  });
  const controller = new AbortController();

  const pending = service.executeAttempt(attemptInput(manifest), controller.signal);
  await queryStarted;
  controller.abort();
  const result = await pending;

  assert.equal(result.report, null);
  assert.equal(result.attempt.state, 'FAILED');
  assert.equal(result.attempt.failureCode, 'EXECUTION_CANCELLED');
  assert.equal(completions.length, 1);
  assert.equal(completions[0]?.failureCode, 'EXECUTION_CANCELLED');
  assert.ok(queryCalls.size >= 1);
  assert.ok([...queryCalls.values()].every((calls) => calls === 1));
});

test('new attempts return bounded summaries while persisting only status items', async () => {
  const { manifest, snapshot } = fixture();
  let createTimeoutMs = 0;
  const completions: CompleteEvidenceAttemptInput[] = [];
  const runningAttempt = attemptRecord(manifest, 'RUNNING');
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(),
    loadDatabaseNow: async () => DATABASE_NOW,
    repository: {
      async getReportAttemptByIdempotencyKey() {
        return null;
      },
      async createReportAttempt(input) {
        createTimeoutMs = input.totalTimeoutMs;
        return { attempt: runningAttempt, created: true };
      },
      async completeReportAttempt(input) {
        completions.push(input);
        return {
          ...runningAttempt,
          state: input.state,
          evidenceStatus: input.evidenceStatus,
          failureCode: input.failureCode,
          completedAt: DATABASE_NOW,
          totalDurationMs: input.totalDurationMs,
        };
      },
      async getManifest() {
        return manifest;
      },
      async loadContractSnapshot() {
        return snapshot;
      },
    },
    createQueryAdapter: () => ({
      async query(recipe, range) {
        return sourceResult(recipe, range);
      },
    }),
    createBusinessCheckAdapter: () => ({
      async check(recipe, checkedAt) {
        if (!recipe.businessCheckId) throw new Error('business check id missing');
        return {
          source: 'BUSINESS_CHECK',
          recipeId: recipe.recipeId,
          businessCheckId: recipe.businessCheckId,
          status: 'PASS',
          checkedAt,
          reasonCode: null,
        };
      },
    }),
  });

  const result = await service.executeAttempt(attemptInput(manifest));

  assert.equal(result.replayed, false);
  assert.equal(result.report?.evidenceStatus, 'AVAILABLE');
  assert.ok(result.report?.recipeSummaries.some((summary) =>
    summary.window === 'active' && summary.summary !== null));
  assert.ok(result.report?.baselineComparisons.some((comparison) =>
    comparison.status === 'AVAILABLE' && comparison.delta !== null));
  assert.equal(result.attempt.state, 'COMPLETED');
  assert.equal(createTimeoutMs, enabledConfig().totalTimeoutMs);
  assert.equal(completions[0]?.state, 'COMPLETED');
  assert.equal(completions[0]?.items.length, manifest.recipes.length);
  assert.ok(completions[0]?.items.every((item) =>
    !('numericSummary' in item) && !('providerResponse' in item)));
  assert.deepEqual(Object.keys(completions[0]!).sort(), [
    'attemptId', 'evidenceStatus', 'failureCode', 'items', 'state', 'totalDurationMs',
  ]);
});

test('a frozen manifest cannot be paired with a different captured query plan', async () => {
  const { manifest, snapshot } = fixture();
  const changedPlan = {
    ...snapshot.renderedPlan,
    windowLimits: {
      ...snapshot.renderedPlan.windowLimits,
      baseline: snapshot.renderedPlan.windowLimits.baseline + 1,
    },
  };
  const mismatch = parseEvidenceStoredContractSnapshot({
    ...createEvidenceCaptureSnapshot(snapshot.contractRevision, snapshot.evidence, changedPlan),
    snapshotId: snapshot.snapshotId,
    sourceFaultRunId: snapshot.sourceFaultRunId,
    scenario: snapshot.scenario,
    contractSchemaVersion: snapshot.contractSchemaVersion,
    rendererRevision: changedPlan.rendererRevision,
    evaluationRevision: changedPlan.evaluationRevision,
    createdAt: snapshot.createdAt,
  });
  const service = new EvidenceReportService({
    getConfig: () => enabledConfig(),
    loadDatabaseNow: async () => DATABASE_NOW,
  });
  await assert.rejects(
    service.execute(manifest, mismatch),
    (error: unknown) => error instanceof EvidenceReportServiceError
      && error.code === 'EVIDENCE_REPORT_MANIFEST_INVALID',
  );
});

function fixture(scenario = 'BROWSE_REPORT_SQL'): {
  readonly manifest: EvidenceManifestRecord;
  readonly snapshot: EvidenceStoredContractSnapshotRecord;
} {
  const definition = listScenarioDefinitions().find((definition) => definition.scenario === scenario)!;
  const contract = resolveScenarioContract(definition);
  const renderedPlan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const snapshot = parseEvidenceStoredContractSnapshot({
    ...createEvidenceCaptureSnapshot(
      getScenarioContractRevision(contract),
      contract.evidence,
      renderedPlan,
    ),
    snapshotId: '223e4567-e89b-12d3-a456-426614174001',
    sourceFaultRunId: '123e4567-e89b-12d3-a456-426614174000',
    scenario: definition.scenario,
    contractSchemaVersion: 'evidence-contract.v1',
    rendererRevision: renderedPlan.rendererRevision,
    evaluationRevision: renderedPlan.evaluationRevision,
    createdAt: '2026-10-09T05:00:00.000Z',
  });
  const timeline = {
    createdAt: '2026-10-09T05:00:00.000Z',
    prepareStartedAt: '2026-10-09T05:01:00.000Z',
    activeAt: '2026-10-09T05:05:00.000Z',
    stopRequestedAt: '2026-10-09T05:10:00.000Z',
    recoveryStartedAt: '2026-10-09T05:11:00.000Z',
    recoveredAt: '2026-10-09T05:15:00.000Z',
    cleanupFinishedAt: null,
    terminalAt: '2026-10-09T05:16:00.000Z',
    terminalState: 'RECOVERED' as const,
  };
  const draft = createEvidenceManifestDraft(snapshot, timeline);
  const manifest = parseEvidenceManifest({
    ...draft,
    manifestId: '323e4567-e89b-12d3-a456-426614174002',
    manifestRevision: 1,
    manifestHash: getEvidenceManifestHash(draft),
    sourceRunRetained: true,
    materializedAt: DATABASE_NOW,
  });
  return { manifest, snapshot };
}

function enabledConfig(queryEnabled = true, executionEnabled = queryEnabled) {
  return parseEvidenceWebConfig({
    EVIDENCE_QUERY_ENABLED: String(queryEnabled),
    EVIDENCE_QUERY_EXECUTION_ENABLED: String(executionEnabled),
    EVIDENCE_PROMETHEUS_BASE_URL: 'http://prometheus.internal',
    EVIDENCE_LOKI_BASE_URL: 'http://loki.internal',
    EVIDENCE_TEMPO_BASE_URL: 'http://tempo.internal',
  });
}

function attemptInput(manifest: EvidenceManifestRecord) {
  return {
    sourceFaultRunId: manifest.sourceFaultRunId,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-report-request-001',
    operatorId: 7,
    correlationId: null,
  };
}

function attemptRecord(
  manifest: EvidenceManifestRecord,
  state: 'RUNNING' | 'COMPLETED',
) {
  return {
    attemptId: '423e4567-e89b-12d3-a456-426614174003',
    manifestId: manifest.manifestId,
    sourceFaultRunId: manifest.sourceFaultRunId,
    requestHash: 'a'.repeat(64),
    state,
    evidenceStatus: state === 'COMPLETED' ? 'AVAILABLE' as const : null,
    operatorAuditId: 7,
    requestedAt: DATABASE_NOW,
    deadlineAt: '2026-10-09T06:00:20.000Z',
    completedAt: state === 'COMPLETED' ? DATABASE_NOW : null,
    totalDurationMs: state === 'COMPLETED' ? 100 : null,
    failureCode: null,
  };
}

function sourceResult(
  recipe: RenderedEvidenceRecipe,
  range: EvidenceQueryRange,
): EvidenceQueryClientResponse {
  if (recipe.source === 'TEMPO') {
    return {
      source: 'TEMPO',
      recipeId: recipe.recipeId,
      traceCount: 1,
      durationsMs: [2_100],
      truncated: false,
      reasonCode: null,
    };
  }
  if (recipe.source !== 'PROMETHEUS' && recipe.source !== 'LOKI') {
    throw new Error('unexpected source query');
  }
  const startMs = Date.parse(range.startAt);
  const endMs = Date.parse(range.endAt);
  const stepSec = computeRangeStepSeconds(startMs, endMs);
  const pointCount = Math.floor((endMs - startMs) / (stepSec * 1000)) + 1;
  const result: MetricRangeResult = {
    source: recipe.source,
    recipeId: recipe.recipeId,
    startAt: range.startAt,
    endAt: range.endAt,
    stepSec,
    hasWarnings: false,
    truncated: false,
    series: [Array.from({ length: pointCount }, (_, index) => ({
      timestampMs: startMs + index * stepSec * 1000,
      value: 3,
      reasonCode: null,
    }))],
  };
  return result;
}
