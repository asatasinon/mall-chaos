import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';
import { resolveScenarioContract } from './scenario-contract';
import {
  assessEvidenceQueryCoverage,
  combineEvidenceQueryCoverage,
  compareEvidenceBaseline,
  summarizeEvidenceResult,
} from './evidence-query-coverage';
import type { MetricRangeResult, TempoSearchResult } from './evidence-query-clients';
import { preflightEvidenceQuery } from './evidence-query-preflight';

const startAt = '2026-10-09T05:00:00.000Z';
const endAt = '2026-10-09T06:00:00.000Z';
const startMs = Date.parse(startAt);
const stepSec = 15;

test('complete metric series receive FULL coverage without summing or filling samples', () => {
  const result = metricResult({
    series: [Array.from({ length: 241 }, (_, index) => ({
      timestampMs: startMs + index * stepSec * 1000,
      value: index + 1,
      reasonCode: null,
    }))],
  });
  assert.deepEqual(assessEvidenceQueryCoverage(result), {
    availability: 'AVAILABLE',
    coverage: 'FULL',
    reasonCodes: [],
  });
});

test('sample gaps, NaN/Inf, provider warnings and truncation reduce coverage', () => {
  const gap = assessEvidenceQueryCoverage(metricResult({
    series: [Array.from({ length: 240 }, (_, index) => ({
      timestampMs: startMs + index * stepSec * 1000,
      value: index,
      reasonCode: null,
    }))],
  }));
  assert.equal(gap.coverage, 'PARTIAL');
  assert.ok(gap.reasonCodes.includes('SAMPLE_GAP'));

  const degraded = assessEvidenceQueryCoverage(metricResult({
    hasWarnings: true,
    truncated: true,
    series: [Array.from({ length: 241 }, (_, index) => ({
      timestampMs: startMs + index * stepSec * 1000,
      value: index === 3 ? null : index,
      reasonCode: index === 3 ? 'NON_FINITE_SAMPLE' : null,
    }))],
  }));
  assert.equal(degraded.availability, 'AVAILABLE');
  assert.equal(degraded.coverage, 'PARTIAL');
  assert.deepEqual(degraded.reasonCodes, [
    'NON_FINITE_SAMPLE',
    'PROVIDER_WARNING',
    'QUERY_RESULT_TRUNCATED',
  ]);
});

test('latest summary is deterministic when several series share the latest timestamp', () => {
  const first = metricResult({
    series: [[
      { timestampMs: startMs, value: 1, reasonCode: null },
      { timestampMs: startMs + 1000, value: 5, reasonCode: null },
    ], [
      { timestampMs: startMs, value: 2, reasonCode: null },
      { timestampMs: startMs + 1000, value: 50, reasonCode: null },
    ]],
  });
  const reversed = { ...first, series: [...first.series].reverse() };
  assert.equal(summarizeEvidenceResult(first)?.latest, 50);
  assert.equal(summarizeEvidenceResult(reversed)?.latest, 50);
});

test('preflight partial history prevents a full backend response from becoming FULL evidence', () => {
  const [recipe] = getMetricBaselineRecipes();
  const window = {
    name: 'active' as const,
    state: 'READY' as const,
    canonicalStartAt: '2026-10-09T05:00:00.000Z',
    canonicalEndAt: '2026-10-09T05:10:00.000Z',
    reasonCode: null,
  };
  const preflight = preflightEvidenceQuery(
    recipe,
    window,
    { baseUrl: 'http://prometheus.internal', retentionSec: 3600 },
    '2026-10-09T06:00:00.000Z',
  );
  assert.equal(preflight.executedStartAt, '2026-10-09T05:05:00.000Z');
  const response = metricResult({
    recipeId: recipe.recipeId,
    startAt: preflight.executedStartAt!,
    endAt: preflight.executedEndAt!,
    series: [Array.from({ length: 21 }, (_, index) => ({
      timestampMs: Date.parse(preflight.executedStartAt!) + index * stepSec * 1000,
      value: index,
      reasonCode: null,
    }))],
  });
  const combined = combineEvidenceQueryCoverage(
    preflight,
    assessEvidenceQueryCoverage(response),
  );
  assert.equal(assessEvidenceQueryCoverage(response).coverage, 'FULL');
  assert.equal(combined.coverage, 'PARTIAL');
  assert.equal(combined.predicateOutcome, 'INCONCLUSIVE');
  assert.deepEqual(combined.reasonCodes, ['RETENTION_LOOKBACK_PARTIAL']);
});

test('empty metrics are NO_DATA with NONE coverage and never become zero-valued samples', () => {
  const noSeries = assessEvidenceQueryCoverage(metricResult({ series: [] }));
  assert.deepEqual(noSeries, {
    availability: 'NO_DATA',
    coverage: 'NONE',
    reasonCodes: ['NO_MATCHING_SERIES'],
  });
  const noSamples = assessEvidenceQueryCoverage(metricResult({ series: [[]] }));
  assert.deepEqual(noSamples, {
    availability: 'NO_DATA',
    coverage: 'NONE',
    reasonCodes: ['NO_SAMPLES'],
  });
});

test('Tempo incomplete search is PARTIAL and only explicit completed empty searches are FULL', () => {
  const incomplete = assessEvidenceQueryCoverage({
    source: 'TEMPO',
    recipeId: 'query.tempo.errors',
    traceCount: 0,
    durationsMs: [],
    truncated: true,
    reasonCode: 'SEARCH_INCOMPLETE',
  });
  assert.deepEqual(incomplete, {
    availability: 'NO_DATA',
    coverage: 'PARTIAL',
    reasonCodes: ['SEARCH_INCOMPLETE'],
  });

  const completeEmpty: TempoSearchResult = {
    source: 'TEMPO',
    recipeId: 'query.tempo.errors',
    traceCount: 0,
    durationsMs: [],
    truncated: false,
    reasonCode: null,
  };
  assert.deepEqual(assessEvidenceQueryCoverage(completeEmpty), {
    availability: 'NO_DATA',
    coverage: 'FULL',
    reasonCodes: [],
  });
});

test('baseline comparison requires complete compatible numeric results and omits zero-baseline percentages', () => {
  const [activeRecipe, baselineRecipe] = getMetricBaselineRecipes();
  const shortRangeEnd = new Date(startMs + 4 * stepSec * 1000).toISOString();
  const active = metricResult({
    recipeId: activeRecipe.recipeId,
    endAt: shortRangeEnd,
    series: [metricSamples([2, 3, 4, 5, 6])],
  });
  const baseline = metricResult({
    recipeId: baselineRecipe.recipeId,
    endAt: shortRangeEnd,
    series: [metricSamples([0, 0, 0, 0, 0])],
  });
  const compatibleBaseline = metricResult({
    recipeId: baselineRecipe.recipeId,
    endAt: shortRangeEnd,
    series: [metricSamples([1, 2, 3, 4, 5])],
  });
  const compatible = compareEvidenceBaseline(
    activeRecipe,
    baselineRecipe,
    active,
    compatibleBaseline,
    assessEvidenceQueryCoverage(active),
    assessEvidenceQueryCoverage(compatibleBaseline),
  );
  assert.equal(compatible.status, 'AVAILABLE');
  assert.deepEqual(compatible.percentDelta, { minimum: 100, maximum: 20, latest: 20 });

  const comparison = compareEvidenceBaseline(
    activeRecipe,
    baselineRecipe,
    active,
    baseline,
    assessEvidenceQueryCoverage(active),
    assessEvidenceQueryCoverage(baseline),
  );
  assert.equal(comparison.status, 'AVAILABLE');
  assert.deepEqual(comparison.delta, {
    pointCount: 5,
    minimum: 2,
    maximum: 6,
    latest: 6,
  });
  assert.deepEqual(comparison.percentDelta, {
    minimum: null,
    maximum: null,
    latest: null,
  });
  assert.equal(comparison.reasonCode, 'ZERO_BASELINE_PERCENTAGE_OMITTED');

  const partialActive = metricResult({
    recipeId: activeRecipe.recipeId,
    endAt: shortRangeEnd,
    series: [metricSamples([2, 3, 4, 5, 6]).slice(0, 4)],
  });
  const unavailable = compareEvidenceBaseline(
    activeRecipe,
    baselineRecipe,
    partialActive,
    baseline,
    assessEvidenceQueryCoverage(partialActive),
    assessEvidenceQueryCoverage(baseline),
  );
  assert.equal(unavailable.status, 'BASELINE_UNAVAILABLE');
  assert.equal(unavailable.delta, null);
});

test('COUNT baselines remain side-by-side context and are never normalized or differenced', () => {
  const [activeRecipe, baselineRecipe] = getTempoBaselineRecipes();
  const active: TempoSearchResult = {
    source: 'TEMPO',
    recipeId: activeRecipe.recipeId,
    traceCount: 25,
    durationsMs: Array.from({ length: 25 }, () => 2100),
    truncated: false,
    reasonCode: null,
  };
  const baseline: TempoSearchResult = {
    ...active,
    recipeId: baselineRecipe.recipeId,
    traceCount: 10,
    durationsMs: Array.from({ length: 10 }, () => 2100),
  };
  const comparison = compareEvidenceBaseline(
    activeRecipe,
    baselineRecipe,
    active,
    baseline,
    assessEvidenceQueryCoverage(active),
    assessEvidenceQueryCoverage(baseline),
  );
  assert.equal(comparison.status, 'COUNT_CONTEXT_ONLY');
  assert.equal(comparison.active?.latest, 25);
  assert.equal(comparison.baseline?.latest, 10);
  assert.equal(comparison.delta, null);
  assert.equal(comparison.percentDelta, null);

  const emptyActive: TempoSearchResult = {
    ...active,
    traceCount: 0,
    durationsMs: [],
  };
  const emptyBaseline: TempoSearchResult = {
    ...baseline,
    traceCount: 0,
    durationsMs: [],
  };
  const emptyComparison = compareEvidenceBaseline(
    activeRecipe,
    baselineRecipe,
    emptyActive,
    emptyBaseline,
    assessEvidenceQueryCoverage(emptyActive),
    assessEvidenceQueryCoverage(emptyBaseline),
  );
  assert.equal(emptyComparison.status, 'COUNT_CONTEXT_ONLY');
  assert.equal(emptyComparison.active?.pointCount, 0);
  assert.equal(emptyComparison.baseline?.latest, 0);
  assert.equal(emptyComparison.delta, null);
});

function getMetricBaselineRecipes() {
  return getBaselineRecipes('PROMETHEUS', 'HTTP_P99');
}

function getTempoBaselineRecipes() {
  return getBaselineRecipes('TEMPO', 'SERVICE_SLOW_REQUESTS');
}

function getBaselineRecipes(source: string, template: string) {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'ORDER_QUERY_SURGE')!;
  const contract = resolveScenarioContract(definition);
  const plan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const active = plan.recipes.find((recipe) =>
    recipe.source === source && recipe.template === template && recipe.window === 'active');
  const baseline = plan.recipes.find((recipe) =>
    recipe.source === source && recipe.template === template && recipe.window === 'baseline');
  if (!active || !baseline) throw new Error(`BASELINE_RECIPE_MISSING:${source}:${template}`);
  return [active, baseline] as const;
}

function metricSamples(values: readonly number[]) {
  return values.map((value, index) => ({
    timestampMs: Date.parse(startAt) + index * stepSec * 1000,
    value,
    reasonCode: null,
  }));
}

function metricResult(
  overrides: Partial<MetricRangeResult>,
): MetricRangeResult {
  return {
    source: 'PROMETHEUS',
    recipeId: 'query.prometheus.metric',
    startAt,
    endAt,
    stepSec,
    hasWarnings: false,
    truncated: false,
    series: [],
    ...overrides,
  };
}
