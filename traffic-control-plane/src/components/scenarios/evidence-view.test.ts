import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindEvidenceHistoryToManifests,
  buildEvidencePanelProjection,
  copyFrozenEvidenceQuery,
  parseEvidenceLiveReport,
  parseEvidenceManifestView,
  parseEvidenceNoteHistory,
  parseEvidenceReportHistory,
} from './evidence-view';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const MANIFEST_ID = '323e4567-e89b-12d3-a456-426614174002';
const ATTEMPT_ID = '423e4567-e89b-12d3-a456-426614174003';
const NOW = '2026-10-11T06:00:00.000Z';

test('Evidence projection keeps control, historical telemetry, CURRENT checks, and effect assessment separate', () => {
  const manifest = parseEvidenceManifestView(manifestFixture(), RUN_ID);
  const reports = parseEvidenceReportHistory({ reports: [reportFixture()] });
  assert.ok(manifest);
  assert.ok(reports);

  const projection = buildEvidencePanelProjection(manifest, reports);

  assert.equal(projection.telemetryStatus, 'PARTIAL');
  assert.equal(projection.effectAssessment, 'NOT_ASSESSED');
  assert.equal(projection.comparisons.length, 1);
  assert.equal(projection.comparisons[0]?.baseline?.availability, 'NO_DATA');
  assert.equal(projection.comparisons[0]?.active?.availability, 'AVAILABLE');
  assert.equal(projection.currentChecks[0]?.item?.queriedAt, NOW);
  assert.equal(projection.executedRanges.length, 2);

  for (const mismatchedReport of [
    { ...reports[0]!, manifestHash: 'f'.repeat(64) },
    { ...reports[0]!, manifestRevision: 2 },
  ]) {
    assert.equal(bindEvidenceHistoryToManifests([manifest], [mismatchedReport], []), null);
    assert.equal(buildEvidencePanelProjection(manifest, [mismatchedReport]).report, null);
  }
});

test('Evidence UI parsers bind records to the source Run and project only allowlisted fields', () => {
  const manifestValue = manifestFixture();
  const manifest = parseEvidenceManifestView(manifestValue, RUN_ID);
  const reports = parseEvidenceReportHistory({
    reports: [{
      ...reportFixture(),
      providerResponse: 'raw-provider-body',
      numericSummary: { secret: 'must-not-render' },
    }],
  });
  const notes = parseEvidenceNoteHistory({
    notes: [{
      noteId: '623e4567-e89b-12d3-a456-426614174005',
      manifestId: MANIFEST_ID,
      sourceFaultRunId: RUN_ID,
      requestHash: 'd'.repeat(64),
      operatorAuditId: 7,
      text: 'A safe operator note.',
      createdAt: NOW,
      rawResponse: 'not-allowed-in-projection',
    }],
  }, RUN_ID);

  assert.ok(manifest);
  assert.ok(reports);
  assert.ok(notes);
  assert.equal(parseEvidenceManifestView(manifestValue, '523e4567-e89b-12d3-a456-426614174004'), null);
  assert.equal(JSON.stringify(manifest).includes('private-frozen-query'), true);
  assert.equal(JSON.stringify(reports).includes('raw-provider-body'), false);
  assert.equal(JSON.stringify(reports).includes('numericSummary'), false);
  assert.equal(JSON.stringify(notes).includes('rawResponse'), false);
});

test('Evidence UI parsers reject malformed and oversized API data', () => {
  assert.equal(parseEvidenceManifestView({ ...manifestFixture(), recipes: [{ source: 'ARBITRARY' }] }, RUN_ID), null);
  const withEndpoint = manifestFixture();
  withEndpoint.recipes[0]!.renderedQuery = 'http://prometheus.internal/api/v1/query';
  assert.equal(parseEvidenceManifestView(withEndpoint, RUN_ID), null);
  assert.equal(parseEvidenceReportHistory({ reports: Array.from({ length: 101 }, () => reportFixture()) }), null);
  assert.equal(parseEvidenceNoteHistory({
    notes: [{
      noteId: '623e4567-e89b-12d3-a456-426614174005',
      manifestId: MANIFEST_ID,
      sourceFaultRunId: '523e4567-e89b-12d3-a456-426614174004',
      requestHash: 'd'.repeat(64),
      operatorAuditId: 7,
      text: 'Wrong source run.',
      createdAt: NOW,
    }],
  }, RUN_ID), null);
});

test('frozen recipe copy reports success/failure without rewriting the query', async () => {
  const query = 'sum(rate(catalog_requests_total[5m]))';
  let copied = '';
  assert.equal(await copyFrozenEvidenceQuery(query, async (value) => { copied = value; }), 'COPIED');
  assert.equal(copied, query);
  assert.equal(await copyFrozenEvidenceQuery(query, async () => { throw new Error('clipboard denied'); }), 'COPY_FAILED');
  assert.equal(await copyFrozenEvidenceQuery('', async () => {}), 'COPY_FAILED');
});

test('history binding omits unknown revisions and rejects report items outside the frozen recipe list', () => {
  const manifest = parseEvidenceManifestView(manifestFixture(), RUN_ID);
  const reports = parseEvidenceReportHistory({ reports: [reportFixture()] });
  assert.ok(manifest);
  assert.ok(reports);

  const unknownRevision = bindEvidenceHistoryToManifests(
    [manifest],
    [{ ...reports[0]!, manifestId: '523e4567-e89b-12d3-a456-426614174004' }],
    [],
  );
  assert.deepEqual(unknownRevision, {
    reports: [],
    notes: [],
    omittedReportCount: 1,
    omittedNoteCount: 0,
  });

  const undeclaredItemReport = {
    ...reports[0]!,
    items: [...reports[0]!.items, {
      ...reports[0]!.items[0]!,
      recipeId: 'invented.recipe',
      window: 'cleanup' as const,
      executedStartAt: '2026-10-11T05:58:00.000Z',
    }],
  };
  assert.equal(bindEvidenceHistoryToManifests([manifest], [undeclaredItemReport], []), null);
});

test('manifest parser rejects a baseline link whose frozen comparison dimensions disagree', () => {
  for (const mutate of [
    (value: ReturnType<typeof manifestFixture>) => { value.recipes[1]!.valueUnit = 'ratio'; },
    (value: ReturnType<typeof manifestFixture>) => { value.recipes[1]!.source = 'TEMPO'; },
    (value: ReturnType<typeof manifestFixture>) => { value.recipes[1]!.lookbackSec = 600; },
  ]) {
    const incompatible = manifestFixture();
    mutate(incompatible);
    assert.equal(parseEvidenceManifestView(incompatible, RUN_ID), null);
  }
});

test('live report projection is bound to the selected Manifest and declared recipe items', () => {
  const manifest = parseEvidenceManifestView(manifestFixture(), RUN_ID);
  const report = reportFixture();
  assert.ok(manifest);
  const liveItems = report.items.map((item) => item.window === 'baseline'
    ? { ...item, availability: 'AVAILABLE' as const, coverage: 'FULL' as const }
    : item.window === 'active'
      ? { ...item, coverage: 'FULL' as const }
    : item);
  const validLiveReport = {
    manifestId: MANIFEST_ID,
    manifestRevision: 1,
    manifestHash: 'a'.repeat(64),
    evaluatedAt: NOW,
    evidenceStatus: 'PARTIAL',
    effectAssessment: 'INCONCLUSIVE',
    recipeOutcomes: [{ recipeId: 'catalog-report.p99', predicateOutcome: 'INCONCLUSIVE' }],
    items: liveItems,
    recipeSummaries: [{
      recipeId: 'catalog-report.p99',
      source: 'PROMETHEUS',
      window: 'active',
      valueUnit: 'seconds',
      summary: { pointCount: 10, minimum: 1, maximum: 3, latest: 2 },
    }, {
      recipeId: 'catalog-report.p99',
      source: 'PROMETHEUS',
      window: 'baseline',
      valueUnit: 'seconds',
      summary: { pointCount: 10, minimum: 1, maximum: 2, latest: 1 },
    }],
    baselineComparisons: [{
      recipeId: 'catalog-report.p99',
      source: 'PROMETHEUS',
      valueUnit: 'seconds',
      status: 'AVAILABLE',
      reasonCode: null,
      active: { pointCount: 10, minimum: 1, maximum: 3, latest: 2 },
      baseline: { pointCount: 10, minimum: 1, maximum: 2, latest: 1 },
      delta: { pointCount: 10, minimum: 0, maximum: 1, latest: 1 },
      percentDelta: { minimum: 0, maximum: 50, latest: 100 },
    }],
    numericSummary: { raw: 'not projected' },
  };
  const liveReport = parseEvidenceLiveReport(validLiveReport, manifest);
  assert.ok(liveReport);
  assert.equal(liveReport.effectAssessment, 'INCONCLUSIVE');
  assert.equal(liveReport.baselineComparisons[0]?.delta?.latest, 1);
  assert.equal(JSON.stringify(liveReport).includes('numericSummary'), false);
  assert.equal(parseEvidenceLiveReport({
    ...validLiveReport,
    items: validLiveReport.items.map((item) => item.window === 'active'
      ? { ...item, coverage: 'PARTIAL' }
      : item),
  }, manifest), null);
  assert.equal(parseEvidenceLiveReport({
    ...validLiveReport,
    baselineComparisons: validLiveReport.baselineComparisons.map((comparison) => ({
      ...comparison,
      active: { ...comparison.active, latest: 2.5 },
    })),
  }, manifest), null);
  const extremeActive = { pointCount: 10, minimum: 1e308, maximum: 1e308, latest: 1e308 };
  const extremeBaseline = { pointCount: 10, minimum: -1e308, maximum: -1e308, latest: -1e308 };
  assert.equal(parseEvidenceLiveReport({
    ...validLiveReport,
    recipeSummaries: validLiveReport.recipeSummaries.map((summary) => ({
      ...summary,
      summary: summary.window === 'active' ? extremeActive : extremeBaseline,
    })),
    baselineComparisons: [{
      ...validLiveReport.baselineComparisons[0]!,
      reasonCode: 'NON_FINITE_BASELINE_PERCENTAGE_OMITTED',
      active: extremeActive,
      baseline: extremeBaseline,
      delta: { pointCount: 10, minimum: 0, maximum: 0, latest: 0 },
      percentDelta: { minimum: null, maximum: null, latest: null },
    }],
  }, manifest), null);
  assert.equal(parseEvidenceLiveReport({
    ...validLiveReport,
    items: [...validLiveReport.items, validLiveReport.items[1]],
  }, manifest), null);
  assert.equal(parseEvidenceLiveReport({
    manifestId: MANIFEST_ID,
    manifestRevision: 1,
    manifestHash: 'f'.repeat(64),
    evaluatedAt: NOW,
    evidenceStatus: 'PARTIAL',
    effectAssessment: 'INCONCLUSIVE',
    recipeOutcomes: [],
    items: [],
  }, manifest), null);
  assert.equal(parseEvidenceLiveReport({
    manifestId: MANIFEST_ID,
    manifestRevision: 1,
    manifestHash: 'a'.repeat(64),
    evaluatedAt: NOW,
    evidenceStatus: 'PARTIAL',
    effectAssessment: 'INCONCLUSIVE',
    recipeOutcomes: [],
    items: [{ ...report.items[0], recipeId: 'invented.recipe' }],
    recipeSummaries: [],
    baselineComparisons: [],
  }, manifest), null);
});

test('complete empty Tempo counts remain explicit zero-count context without becoming effect outcomes', () => {
  const manifestValue = manifestFixture();
  for (const recipe of manifestValue.recipes.slice(0, 2)) {
    recipe.source = 'TEMPO';
    recipe.valueUnit = 'count';
  }
  const manifest = parseEvidenceManifestView(manifestValue, RUN_ID);
  assert.ok(manifest);

  const zeroCountSummary = { pointCount: 0, minimum: 0, maximum: 0, latest: 0 };
  const report = reportFixture();
  const items = report.items.map((item) => item.window === 'baseline' || item.window === 'active'
    ? {
      ...item,
      source: 'TEMPO' as const,
      availability: 'NO_DATA' as const,
      coverage: 'FULL' as const,
      predicateOutcome: 'INCONCLUSIVE' as const,
    }
    : item);
  const liveReport = parseEvidenceLiveReport({
    manifestId: MANIFEST_ID,
    manifestRevision: 1,
    manifestHash: 'a'.repeat(64),
    evaluatedAt: NOW,
    evidenceStatus: 'PARTIAL',
    effectAssessment: 'INCONCLUSIVE',
    recipeOutcomes: [],
    items,
    recipeSummaries: [{
      recipeId: 'catalog-report.p99',
      source: 'TEMPO',
      window: 'baseline',
      valueUnit: 'count',
      summary: zeroCountSummary,
    }, {
      recipeId: 'catalog-report.p99',
      source: 'TEMPO',
      window: 'active',
      valueUnit: 'count',
      summary: zeroCountSummary,
    }],
    baselineComparisons: [{
      recipeId: 'catalog-report.p99',
      source: 'TEMPO',
      valueUnit: 'count',
      status: 'COUNT_CONTEXT_ONLY',
      reasonCode: 'COUNT_WINDOWS_DIFFER',
      active: zeroCountSummary,
      baseline: zeroCountSummary,
      delta: null,
      percentDelta: null,
    }],
  }, manifest);

  assert.ok(liveReport);
  assert.equal(liveReport.baselineComparisons[0]?.status, 'COUNT_CONTEXT_ONLY');
  assert.equal(liveReport.recipeSummaries.find((summary) => summary.window === 'active')?.summary?.latest, 0);
  assert.equal(liveReport.effectAssessment, 'INCONCLUSIVE');
});

function manifestFixture() {
  return {
    manifestId: MANIFEST_ID,
    sourceFaultRunId: RUN_ID,
    manifestRevision: 1,
    manifestHash: 'a'.repeat(64),
    sourceRunRetained: true,
    materializedAt: NOW,
    windows: [{
      name: 'baseline',
      state: 'READY',
      canonicalStartAt: '2026-10-11T05:40:00.000Z',
      canonicalEndAt: '2026-10-11T05:45:00.000Z',
      reasonCode: null,
    }, {
      name: 'active',
      state: 'READY',
      canonicalStartAt: '2026-10-11T05:45:00.000Z',
      canonicalEndAt: '2026-10-11T05:50:00.000Z',
      reasonCode: null,
    }, {
      name: 'recovery',
      state: 'READY',
      canonicalStartAt: '2026-10-11T05:50:00.000Z',
      canonicalEndAt: '2026-10-11T05:55:00.000Z',
      reasonCode: null,
    }],
    recipes: [{
      recipeId: 'catalog-report.p99',
      source: 'PROMETHEUS',
      window: 'baseline',
      observationMode: 'WINDOWED',
      required: false,
      valueUnit: 'seconds',
      lookbackSec: 300,
      baselineForRecipeId: 'catalog-report.p99',
      businessCheckId: null,
      renderedQuery: 'private-frozen-query',
    }, {
      recipeId: 'catalog-report.p99',
      source: 'PROMETHEUS',
      window: 'active',
      observationMode: 'WINDOWED',
      required: true,
      valueUnit: 'seconds',
      lookbackSec: 300,
      baselineForRecipeId: null,
      businessCheckId: null,
      renderedQuery: 'sum(rate(catalog_requests_total[5m]))',
    }, {
      recipeId: 'catalog-product-list.current',
      source: 'BUSINESS_CHECK',
      window: 'recovery',
      observationMode: 'CURRENT',
      required: true,
      valueUnit: 'boolean',
      lookbackSec: 0,
      baselineForRecipeId: null,
      businessCheckId: 'CATALOG_PRODUCT_LIST',
      renderedQuery: null,
    }],
    limitations: [{ code: 'FUTURE_TAIL', window: 'recovery' }],
  };
}

function reportFixture() {
  return {
    attemptId: ATTEMPT_ID,
    manifestId: MANIFEST_ID,
    manifestRevision: 1,
    manifestHash: 'a'.repeat(64),
    state: 'COMPLETED',
    evidenceStatus: 'PARTIAL',
    requestedAt: NOW,
    completedAt: NOW,
    totalDurationMs: 100,
    failureCode: null,
    operatorAuditId: 7,
    items: [{
      recipeId: 'catalog-report.p99',
      source: 'PROMETHEUS',
      window: 'baseline',
      availability: 'NO_DATA',
      coverage: 'NONE',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCode: 'SOURCE_NO_DATA',
      durationMs: 20,
      queriedAt: NOW,
      executedStartAt: '2026-10-11T05:40:00.000Z',
      executedEndAt: '2026-10-11T05:45:00.000Z',
    }, {
      recipeId: 'catalog-report.p99',
      source: 'PROMETHEUS',
      window: 'active',
      availability: 'AVAILABLE',
      coverage: 'PARTIAL',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCode: 'FUTURE_TAIL',
      durationMs: 30,
      queriedAt: NOW,
      executedStartAt: '2026-10-11T05:45:00.000Z',
      executedEndAt: '2026-10-11T05:48:00.000Z',
    }, {
      recipeId: 'catalog-product-list.current',
      source: 'BUSINESS_CHECK',
      window: 'recovery',
      availability: 'AVAILABLE',
      coverage: 'FULL',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCode: null,
      durationMs: 10,
      queriedAt: NOW,
      executedStartAt: null,
      executedEndAt: null,
    }],
  };
}
