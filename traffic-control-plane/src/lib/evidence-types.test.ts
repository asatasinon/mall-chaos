import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalizeEvidenceContractPlan,
  getScenarioContractRevision,
  resolveScenarioContract,
} from './scenario-contract';
import { listScenarioDefinitions } from './fault-run-catalog';
import {
  EVIDENCE_EVALUATION_REVISION,
  EVIDENCE_RENDERER_REVISION,
  EVIDENCE_RENDERED_PLAN_SCHEMA_VERSION,
  EvidenceTypeError,
  createEvidenceCaptureSnapshot,
  canonicalizeEvidenceRenderedPlan,
  getEvidenceManifestHash,
  getEvidenceRenderedPlanHash,
  getEvidenceTimelineHash,
  isEvidenceRenderedPlan,
  parseEvidenceAttempt,
  parseEvidenceAttemptItem,
  parseEvidenceCaptureSnapshot,
  parseEvidenceJsonColumn,
  parseEvidenceManifest,
  parseEvidenceOperatorNote,
  parseEvidenceSqlTimestamp,
  serializeEvidenceCaptureSnapshot,
  type EvidenceRenderedPlan,
  type RenderedEvidenceRecipe,
} from './evidence-types';

const SCENARIO = listScenarioDefinitions()[0]!;
const CONTRACT = resolveScenarioContract(SCENARIO);
const TIMESTAMP = '2026-10-09T06:00:00.000Z';
const UUID = '123e4567-e89b-12d3-a456-426614174000';
const SHA256 = 'a'.repeat(64);

test('rendered Evidence plan reuses Phase 3 DSL and has a stable independent content hash', () => {
  const recipes = CONTRACT.evidence.recipes.map(toRenderedRecipe);
  const plan = createRenderedPlan(recipes);
  assert.equal(isEvidenceRenderedPlan(plan), true);

  const snapshot = createEvidenceCaptureSnapshot(
    getScenarioContractRevision(CONTRACT),
    CONTRACT.evidence,
    plan,
  );
  const serialized = serializeEvidenceCaptureSnapshot(snapshot);
  const parsed = parseEvidenceCaptureSnapshot(serialized);
  assert.equal(serialized.contractRevision, snapshot.contractRevision);
  assert.equal(serialized.contractHash, snapshot.contractHash);
  assert.equal(serialized.renderedPlanHash, getEvidenceRenderedPlanHash(plan));
  assert.equal(canonicalizeEvidenceContractPlan(parsed.evidence), serialized.contractJson);
  assert.equal(canonicalizeEvidenceRenderedPlan(parsed.renderedPlan), serialized.renderedPlanJson);
});

test('persisted capture snapshot rejects altered hash, unsupported renderer and extra fields', () => {
  const snapshot = createEvidenceCaptureSnapshot(
    getScenarioContractRevision(CONTRACT),
    CONTRACT.evidence,
    createRenderedPlan(CONTRACT.evidence.recipes.map(toRenderedRecipe)),
  );
  const serialized = serializeEvidenceCaptureSnapshot(snapshot);
  const unknownPlan = {
    ...snapshot.renderedPlan,
    rendererRevision: 'evidence-renderer.v999',
  };

  for (const invalid of [
    { ...serialized, contractHash: '0'.repeat(64) },
    { ...serialized, renderedPlanHash: '0'.repeat(64) },
    { ...serialized, contractRevision: 'not-a-phase3-revision' },
    { ...serialized, rendererRevision: 'renderer' },
    { ...serialized, renderedPlanJson: JSON.stringify({ schemaVersion: 'wrong' }) },
    {
      ...serialized,
      rendererRevision: unknownPlan.rendererRevision,
      renderedPlanJson: JSON.stringify(unknownPlan),
    },
    { ...serialized, unexpected: 'query' },
  ]) {
    assert.throws(
      () => parseEvidenceCaptureSnapshot(invalid),
      (error: unknown) => error instanceof EvidenceTypeError,
    );
  }
});

test('captured query strings and hard limits remain frozen when current plan content changes', () => {
  const originalPlan = createRenderedPlan(CONTRACT.evidence.recipes.map(toRenderedRecipe));
  const snapshot = createEvidenceCaptureSnapshot(
    getScenarioContractRevision(CONTRACT),
    CONTRACT.evidence,
    originalPlan,
  );
  const serialized = serializeEvidenceCaptureSnapshot(snapshot);
  const queryIndex = originalPlan.recipes.findIndex((recipe) => recipe.renderedQuery !== null);
  assert.notEqual(queryIndex, -1);
  const changedPlan: EvidenceRenderedPlan = {
    ...originalPlan,
    windowLimits: { ...originalPlan.windowLimits, active: originalPlan.windowLimits.active - 1 },
    recipes: originalPlan.recipes.map((recipe, index) => index === queryIndex
      ? { ...recipe, renderedQuery: `${recipe.renderedQuery} ` }
      : recipe),
  };
  assert.notEqual(getEvidenceRenderedPlanHash(changedPlan), snapshot.renderedPlanHash);

  const persisted = parseEvidenceCaptureSnapshot(serialized);
  assert.equal(persisted.renderedPlanHash, snapshot.renderedPlanHash);
  assert.equal(
    persisted.renderedPlan.recipes.find(({ recipeId }) =>
      recipeId === originalPlan.recipes[queryIndex]?.recipeId)?.renderedQuery,
    originalPlan.recipes[queryIndex]?.renderedQuery,
  );
  assert.equal(persisted.renderedPlan.windowLimits.active, originalPlan.windowLimits.active);
});

test('manifest guard enforces a closed DTO, safe times, unique recipe-window keys and four windows', () => {
  const snapshot = createEvidenceCaptureSnapshot(
    getScenarioContractRevision(CONTRACT),
    CONTRACT.evidence,
    createRenderedPlan(CONTRACT.evidence.recipes.map(toRenderedRecipe)),
  );
  const manifest = validManifest(snapshot.renderedPlan.recipes);
  assert.deepEqual(parseEvidenceManifest(manifest), manifest);

  const extraField = { ...manifest, providerBody: 'not persisted' };
  const invalidTimeline = {
    ...manifest,
    timeline: { ...manifest.timeline, activeAt: 'not-a-timestamp' },
  };
  const duplicateWindow = {
    ...manifest,
    windows: [...manifest.windows.slice(0, 3), manifest.windows[0]],
  };
  const invalidWindowState = {
    ...manifest,
    windows: manifest.windows.map((window) => window.name === 'cleanup'
      ? { ...window, state: 'READY', canonicalEndAt: null }
      : window),
  };
  for (const [invalid, code] of [
    [extraField, 'EVIDENCE_MANIFEST_INVALID'],
    [invalidTimeline, 'EVIDENCE_MANIFEST_TIMELINE_INVALID'],
    [duplicateWindow, 'EVIDENCE_MANIFEST_WINDOWS_INVALID'],
    [invalidWindowState, 'EVIDENCE_MANIFEST_WINDOWS_INVALID'],
  ] as const) {
    assert.throws(
      () => parseEvidenceManifest(invalid),
      (error: unknown) => error instanceof EvidenceTypeError
        && error.code === code,
    );
  }
});

test('attempt guard enforces state, deadline and terminal metadata consistency', () => {
  const running = {
    attemptId: UUID,
    manifestId: UUID,
    sourceFaultRunId: UUID,
    requestHash: SHA256,
    state: 'RUNNING',
    evidenceStatus: null,
    operatorAuditId: null,
    requestedAt: TIMESTAMP,
    deadlineAt: '2026-10-09T06:00:20.000Z',
    completedAt: null,
    totalDurationMs: null,
    failureCode: null,
  };
  assert.deepEqual(parseEvidenceAttempt(running), running);

  const completed = {
    ...running,
    state: 'COMPLETED',
    evidenceStatus: 'PARTIAL',
    completedAt: '2026-10-09T06:00:15.000Z',
    totalDurationMs: 15_000,
  };
  assert.deepEqual(parseEvidenceAttempt(completed), completed);

  for (const invalid of [
    { ...running, state: 'UNKNOWN' },
    { ...running, completedAt: '2026-10-09T06:00:21.000Z' },
    { ...running, deadlineAt: TIMESTAMP },
    { ...running, surpriseQuery: 'free-form' },
    { ...completed, state: 'COMPLETED', evidenceStatus: 'EVIDENCE_UNAVAILABLE' },
    { ...completed, totalDurationMs: null },
  ]) {
    assert.throws(
      () => parseEvidenceAttempt(invalid),
      (error: unknown) => error instanceof EvidenceTypeError
        && error.code === 'EVIDENCE_ATTEMPT_INVALID',
    );
  }
});

test('attempt-item guard rejects unbounded states, values and untrusted raw fields', () => {
  const item = {
    recipeId: 'browse-report.prometheus.active-p99',
    source: 'PROMETHEUS',
    window: 'active',
    availability: 'AVAILABLE',
    coverage: 'FULL',
    predicateOutcome: 'MET',
    reasonCode: null,
    durationMs: 10,
    queriedAt: TIMESTAMP,
    executedStartAt: '2026-10-09T05:55:00.000Z',
    executedEndAt: TIMESTAMP,
  };
  assert.deepEqual(parseEvidenceAttemptItem(item), item);
  for (const invalid of [
    { ...item, source: 'HTTP://PROMETHEUS' },
    { ...item, predicateOutcome: 'SUCCESS' },
    { ...item, reasonCode: 'raw upstream error with secret' },
    { ...item, queryResult: [1, 2, 3] },
  ]) {
    assert.throws(
      () => parseEvidenceAttemptItem(invalid),
      (error: unknown) => error instanceof EvidenceTypeError
        && error.code === 'EVIDENCE_ATTEMPT_ITEM_INVALID',
    );
  }
});

test('operator note guard is bounded and does not accept raw result or control payload fields', () => {
  const note = {
    noteId: UUID,
    manifestId: UUID,
    sourceFaultRunId: UUID,
    requestHash: SHA256,
    operatorAuditId: 42,
    text: 'Inspect the recovery window',
    createdAt: TIMESTAMP,
  };
  assert.deepEqual(parseEvidenceOperatorNote(note), note);
  for (const invalid of [
    { ...note, text: '   ' },
    { ...note, text: 'a'.repeat(2049) },
    { ...note, text: 'bad\u0000text' },
    { ...note, rawLog: 'upstream' },
  ]) {
    assert.throws(
      () => parseEvidenceOperatorNote(invalid),
      (error: unknown) => error instanceof EvidenceTypeError
        && error.code === 'EVIDENCE_NOTE_INVALID',
    );
  }
});

test('JSON-column and SQL-timestamp conversion fail explicitly rather than returning success-shaped defaults', () => {
  assert.deepEqual(parseEvidenceJsonColumn('{"state":"RUNNING"}'), { state: 'RUNNING' });
  assert.deepEqual(parseEvidenceJsonColumn({ state: 'RUNNING' }), { state: 'RUNNING' });
  assert.throws(() => parseEvidenceJsonColumn('{'), /EVIDENCE_JSON_INVALID/);
  assert.equal(parseEvidenceSqlTimestamp(new Date('2026-10-09T06:00:00.000Z')), TIMESTAMP);
  assert.equal(parseEvidenceSqlTimestamp('2026-10-09 06:00:00.000'), TIMESTAMP);
  assert.throws(() => parseEvidenceSqlTimestamp('not-a-date'), /EVIDENCE_JSON_INVALID/);
});

function createRenderedPlan(recipes: RenderedEvidenceRecipe[]): EvidenceRenderedPlan {
  return {
    schemaVersion: EVIDENCE_RENDERED_PLAN_SCHEMA_VERSION,
    rendererRevision: EVIDENCE_RENDERER_REVISION,
    evaluationRevision: EVIDENCE_EVALUATION_REVISION,
    windowLimits: { baseline: 900, active: 3660, recovery: 2100, cleanup: 600 },
    recipes,
  };
}

function toRenderedRecipe(
  recipe: (typeof CONTRACT.evidence.recipes)[number],
): RenderedEvidenceRecipe {
  const businessCheck = recipe.source === 'BUSINESS_CHECK';
  const runEvent = recipe.source === 'RUN_EVENT';
  const aggregation = runEvent
    ? 'TIMELINE'
    : businessCheck
      ? 'CURRENT_BOOLEAN'
      : recipe.window === 'baseline'
        ? 'BASELINE_SUMMARY'
        : recipe.source === 'PROMETHEUS'
          ? recipe.window === 'active' ? 'ACTIVE_ANY_SAMPLE' : 'RECOVERY_ALL_SAMPLES'
          : recipe.source === 'LOKI'
            ? 'LOKI_BUCKET_SERIES'
            : 'TRACE_MATCH_COUNT';
  const valueUnit = runEvent
    ? 'timeline'
    : businessCheck
      ? 'boolean'
      : recipe.source === 'TEMPO' || recipe.source === 'LOKI' ? 'count'
        : recipe.template === 'HTTP_P99' ? 'seconds'
          : recipe.template === 'HTTP_RATE' || recipe.template === 'PAYMENT_TIMEOUT_RATE'
            || recipe.template === 'MYSQL_SLOW_QUERY_RATE' ? 'count_per_second'
            : recipe.template === 'NODE_FILESYSTEM_GROWTH_RATE' ? 'bytes_per_second' : 'ratio';
  const renderedQuery = runEvent || businessCheck ? null : `fixed:${recipe.template}`;
  const businessCheckId = businessCheck
    ? recipe.template as 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT'
    : null;
  return {
    recipeId: recipe.id,
    source: recipe.source,
    window: recipe.window,
    observationMode: recipe.observationMode,
    required: recipe.required,
    template: recipe.template,
    scope: recipe.scope,
    scopeMode: recipe.source === 'LOKI'
      || recipe.source === 'TEMPO' && recipe.scope.fixedLabels !== undefined
      ? 'SERVICE_ONLY'
      : 'DECLARED',
    predicate: recipe.predicate,
    projection: recipe.projection,
    renderedQuery,
    businessCheckId,
    valueUnit,
    lookbackSec: 0,
    aggregation,
    baselineForRecipeId: null,
  };
}

function validManifest(recipes: readonly RenderedEvidenceRecipe[]) {
  const timeline = {
    createdAt: '2026-10-09T05:55:00.000Z',
    prepareStartedAt: '2026-10-09T05:55:01.000Z',
    activeAt: '2026-10-09T05:55:02.000Z',
    stopRequestedAt: '2026-10-09T05:59:00.000Z',
    recoveryStartedAt: '2026-10-09T05:59:01.000Z',
    recoveredAt: '2026-10-09T05:59:02.000Z',
    cleanupFinishedAt: null,
    terminalAt: TIMESTAMP,
    terminalState: 'STOPPED' as const,
  };
  const startAt = '2026-10-09T05:55:00.000Z';
  const windows = (['baseline', 'active', 'recovery', 'cleanup'] as const).map((name) => ({
    name,
    state: 'READY' as const,
    canonicalStartAt: startAt,
    canonicalEndAt: TIMESTAMP,
    reasonCode: null,
  }));
  const draft = {
    manifestSchemaVersion: 'evidence-manifest.v1',
    snapshotId: UUID,
    sourceFaultRunId: UUID,
    scenario: SCENARIO.scenario,
    contractRevision: getScenarioContractRevision(CONTRACT),
    contractHash: SHA256,
    renderedPlanHash: SHA256,
    timelineHash: getEvidenceTimelineHash(timeline),
    timeline,
    windows,
    recipes,
    limitations: [{ code: 'CLEANUP_NOT_COMPLETED', window: 'cleanup' }],
  } as const;
  return {
    ...draft,
    manifestId: UUID,
    manifestRevision: 1,
    manifestHash: getEvidenceManifestHash(draft),
    sourceRunRetained: true,
    materializedAt: TIMESTAMP,
  };
}
