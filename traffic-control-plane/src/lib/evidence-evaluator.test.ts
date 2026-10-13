import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import type {
  MetricRangeResult,
  TempoSearchResult,
} from './evidence-query-clients';
import {
  aggregateEvidenceReportStatus,
  evaluateEvidenceEffectRule,
  evaluateEvidenceRecipePredicate,
  type EvidenceRecipeEvaluation,
  type EvidenceReportStatusFact,
} from './evidence-evaluator';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';
import { resolveScenarioContract } from './scenario-contract';
import type { EvidenceCoverage, EvidenceItemAvailability, RenderedEvidenceRecipe } from './evidence-types';

test('active predicates use any valid sample and recovery predicates require every sample', () => {
  const { active, recovery } = p99Recipes();
  assert.equal(
    evaluateEvidenceRecipePredicate({
      recipe: active,
      availability: 'AVAILABLE',
      coverage: 'FULL',
      result: metricResult(active.recipeId, [1, 6]),
    }),
    'MET',
  );
  assert.equal(
    evaluateEvidenceRecipePredicate({
      recipe: recovery,
      availability: 'AVAILABLE',
      coverage: 'FULL',
      result: metricResult(recovery.recipeId, [4, 6]),
    }),
    'NOT_MET',
  );
  assert.equal(
    evaluateEvidenceRecipePredicate({
      recipe: active,
      availability: 'AVAILABLE',
      coverage: 'PARTIAL',
      result: metricResult(active.recipeId, [6]),
    }),
    'INCONCLUSIVE',
  );
});

test('every partial recipe remains inconclusive even when its returned samples match', () => {
  const { active } = p99Recipes();
  assert.equal(
    evaluateEvidenceRecipePredicate({
      recipe: active,
      availability: 'AVAILABLE',
      coverage: 'PARTIAL',
      result: metricResult(active.recipeId, [6]),
    }),
    'INCONCLUSIVE',
  );
});

test('NONE/CURRENT/timeline predicates remain inconclusive and slow TraceQL compares count presence', () => {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'BROWSE_REPORT_SQL')!;
  const contract = resolveScenarioContract(definition);
  const plan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const slowTrace = plan.recipes.find((recipe) =>
    recipe.source === 'TEMPO' && recipe.template === 'SERVICE_SLOW_REQUESTS' && recipe.window === 'active')!;
  const countOutcome = evaluateEvidenceRecipePredicate({
    recipe: slowTrace,
    availability: 'NO_DATA',
    coverage: 'FULL',
    result: {
      source: 'TEMPO',
      recipeId: slowTrace.recipeId,
      traceCount: 0,
      durationsMs: [],
      truncated: false,
      reasonCode: null,
    } satisfies TempoSearchResult,
  });
  assert.equal(countOutcome, 'NOT_MET');

  for (const recipe of plan.recipes.filter((candidate) =>
    candidate.source === 'BUSINESS_CHECK' || candidate.source === 'RUN_EVENT')) {
    assert.equal(evaluateEvidenceRecipePredicate({
      recipe,
      availability: 'AVAILABLE',
      coverage: 'FULL',
      result: null,
    }), 'INCONCLUSIVE');
  }
});

test('predicate NONE, baseline, and incomplete Tempo results cannot produce effect outcomes', () => {
  const { active } = p99Recipes();
  const noneRecipe = { ...active, predicate: { kind: 'NONE' as const } };
  assert.equal(evaluateEvidenceRecipePredicate({
    recipe: noneRecipe,
    availability: 'AVAILABLE',
    coverage: 'FULL',
    result: metricResult(active.recipeId, [6]),
  }), 'INCONCLUSIVE');

  const baseline = { ...active, window: 'baseline' as const };
  assert.equal(evaluateEvidenceRecipePredicate({
    recipe: baseline,
    availability: 'AVAILABLE',
    coverage: 'FULL',
    result: metricResult(baseline.recipeId, [6]),
  }), 'INCONCLUSIVE');
  assert.throws(() => evaluateEvidenceEffectRule('ANY', [baseline.recipeId], [
    assessment(baseline.recipeId, 'PROMETHEUS', 'baseline', 'MET'),
  ]));

  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'ORDER_QUERY_SURGE')!;
  const contract = resolveScenarioContract(definition);
  const plan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const tempo = plan.recipes.find((recipe) =>
    recipe.source === 'TEMPO' && recipe.template === 'SERVICE_SLOW_REQUESTS' && recipe.window === 'active')!;
  assert.equal(evaluateEvidenceRecipePredicate({
    recipe: tempo,
    availability: 'AVAILABLE',
    coverage: 'PARTIAL',
    result: {
      source: 'TEMPO',
      recipeId: tempo.recipeId,
      traceCount: 1,
      durationsMs: [2_100],
      truncated: true,
      reasonCode: 'SEARCH_INCOMPLETE',
    } satisfies TempoSearchResult,
  }), 'INCONCLUSIVE');
});

test('ALL and ANY rules preserve three-state outcomes', () => {
  const values: EvidenceRecipeEvaluation[] = [
    assessment('one', 'PROMETHEUS', 'active', 'MET'),
    assessment('two', 'TEMPO', 'active', 'INCONCLUSIVE'),
  ];
  assert.deepEqual(evaluateEvidenceEffectRule('ANY', ['one', 'two'], values), {
    assessment: 'OBSERVED',
    recipeOutcomes: [
      { recipeId: 'one', predicateOutcome: 'MET' },
      { recipeId: 'two', predicateOutcome: 'INCONCLUSIVE' },
    ],
  });
  assert.equal(evaluateEvidenceEffectRule('ALL', ['one', 'two'], values).assessment, 'INCONCLUSIVE');
  assert.equal(evaluateEvidenceEffectRule('ALL', ['one', 'two'], [
    assessment('one', 'PROMETHEUS', 'recovery', 'NOT_MET'),
    assessment('two', 'TEMPO', 'recovery', 'INCONCLUSIVE'),
  ]).assessment, 'NOT_OBSERVED');
  assert.equal(evaluateEvidenceEffectRule('ANY', ['one', 'two'], [
    assessment('one', 'PROMETHEUS', 'active', 'NOT_MET'),
    assessment('two', 'TEMPO', 'active', 'NOT_MET'),
  ]).assessment, 'NOT_OBSERVED');
  assert.equal(evaluateEvidenceEffectRule('ANY', ['missing'], []).assessment, 'INCONCLUSIVE');
});

test('ALL/ANY truth table and report status keep observed effects separate from incomplete coverage', () => {
  const cases: readonly {
    mode: 'ALL' | 'ANY';
    outcomes: readonly ['MET' | 'NOT_MET' | 'INCONCLUSIVE', 'MET' | 'NOT_MET' | 'INCONCLUSIVE'];
    expected: 'OBSERVED' | 'NOT_OBSERVED' | 'INCONCLUSIVE';
  }[] = [
    { mode: 'ALL', outcomes: ['MET', 'MET'], expected: 'OBSERVED' },
    { mode: 'ALL', outcomes: ['MET', 'NOT_MET'], expected: 'NOT_OBSERVED' },
    { mode: 'ALL', outcomes: ['MET', 'INCONCLUSIVE'], expected: 'INCONCLUSIVE' },
    { mode: 'ALL', outcomes: ['NOT_MET', 'NOT_MET'], expected: 'NOT_OBSERVED' },
    { mode: 'ALL', outcomes: ['NOT_MET', 'INCONCLUSIVE'], expected: 'NOT_OBSERVED' },
    { mode: 'ALL', outcomes: ['INCONCLUSIVE', 'INCONCLUSIVE'], expected: 'INCONCLUSIVE' },
    { mode: 'ANY', outcomes: ['MET', 'MET'], expected: 'OBSERVED' },
    { mode: 'ANY', outcomes: ['MET', 'NOT_MET'], expected: 'OBSERVED' },
    { mode: 'ANY', outcomes: ['MET', 'INCONCLUSIVE'], expected: 'OBSERVED' },
    { mode: 'ANY', outcomes: ['NOT_MET', 'NOT_MET'], expected: 'NOT_OBSERVED' },
    { mode: 'ANY', outcomes: ['NOT_MET', 'INCONCLUSIVE'], expected: 'INCONCLUSIVE' },
    { mode: 'ANY', outcomes: ['INCONCLUSIVE', 'INCONCLUSIVE'], expected: 'INCONCLUSIVE' },
  ];
  for (const [index, entry] of cases.entries()) {
    const evaluations = entry.outcomes.map((outcome, outcomeIndex) =>
      assessment(`recipe-${outcomeIndex}`, 'PROMETHEUS', 'active', outcome));
    assert.equal(
      evaluateEvidenceEffectRule(entry.mode, ['recipe-0', 'recipe-1'], evaluations).assessment,
      entry.expected,
      `truth-table case ${index}`,
    );
  }

  const anyWithGap = evaluateEvidenceEffectRule('ANY', ['met', 'unknown'], [
    assessment('met', 'PROMETHEUS', 'active', 'MET'),
    assessment('unknown', 'TEMPO', 'active', 'INCONCLUSIVE'),
  ]);
  assert.equal(anyWithGap.assessment, 'OBSERVED');
  assert.equal(aggregateEvidenceReportStatus([
    statusFact('PROMETHEUS', 'active', 'AVAILABLE', 'FULL'),
    statusFact('LOKI', 'active', 'NO_DATA', 'PARTIAL', 'WINDOWED', false),
  ]), 'PARTIAL');
});

test('timeline and CURRENT checks cannot mask unavailable historical telemetry', () => {
  assert.equal(aggregateEvidenceReportStatus([
    statusFact('RUN_EVENT', 'active', 'AVAILABLE', 'FULL'),
    statusFact('BUSINESS_CHECK', 'recovery', 'AVAILABLE', 'FULL', 'CURRENT'),
    statusFact('PROMETHEUS', 'active', 'EVIDENCE_UNAVAILABLE', 'NONE'),
    statusFact('TEMPO', 'active', 'EVIDENCE_UNAVAILABLE', 'NONE', 'WINDOWED', false),
  ]), 'EVIDENCE_UNAVAILABLE');
  assert.equal(aggregateEvidenceReportStatus([
    statusFact('PROMETHEUS', 'active', 'AVAILABLE', 'FULL'),
    statusFact('LOKI', 'active', 'EVIDENCE_UNAVAILABLE', 'NONE', 'WINDOWED', false),
  ]), 'PARTIAL');
  assert.equal(aggregateEvidenceReportStatus([
    statusFact('PROMETHEUS', 'active', 'AVAILABLE', 'FULL'),
    statusFact('RUN_EVENT', 'active', 'AVAILABLE', 'FULL'),
    statusFact('BUSINESS_CHECK', 'recovery', 'AVAILABLE', 'FULL', 'CURRENT'),
  ]), 'AVAILABLE');
  assert.equal(aggregateEvidenceReportStatus([
    statusFact('PROMETHEUS', 'active', 'INVALID_QUERY', 'NONE'),
  ]), 'INVALID_QUERY');
  assert.equal(aggregateEvidenceReportStatus([
    statusFact('TEMPO', 'active', 'NO_DATA', 'FULL'),
  ]), 'AVAILABLE');
});

function p99Recipes(): { active: RenderedEvidenceRecipe; recovery: RenderedEvidenceRecipe } {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'ORDER_QUERY_SURGE')!;
  const contract = resolveScenarioContract(definition);
  const plan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const active = plan.recipes.find((recipe) =>
    recipe.source === 'PROMETHEUS' && recipe.template === 'HTTP_P99' && recipe.window === 'active');
  const recovery = plan.recipes.find((recipe) =>
    recipe.source === 'PROMETHEUS' && recipe.template === 'HTTP_P99' && recipe.window === 'recovery');
  if (!active || !recovery) throw new Error('P99_RECIPE_MISSING');
  return { active, recovery };
}

function metricResult(recipeId: string, values: readonly number[]): MetricRangeResult {
  return {
    source: 'PROMETHEUS',
    recipeId,
    startAt: '2026-10-09T05:00:00.000Z',
    endAt: '2026-10-09T05:00:15.000Z',
    stepSec: 15,
    hasWarnings: false,
    truncated: false,
    series: [values.map((value, index) => ({
      timestampMs: Date.parse('2026-10-09T05:00:00.000Z') + index * 15_000,
      value,
      reasonCode: null,
    }))],
  };
}

function assessment(
  recipeId: string,
  source: 'PROMETHEUS' | 'TEMPO',
  window: EvidenceRecipeEvaluation['window'],
  predicateOutcome: EvidenceRecipeEvaluation['predicateOutcome'],
): EvidenceRecipeEvaluation {
  return { recipeId, source, window, observationMode: 'WINDOWED', predicateOutcome };
}

function statusFact(
  source: EvidenceReportStatusFact['source'],
  window: EvidenceReportStatusFact['window'],
  availability: EvidenceItemAvailability,
  coverage: EvidenceCoverage,
  observationMode: EvidenceReportStatusFact['observationMode'] = 'WINDOWED',
  required = true,
): EvidenceReportStatusFact {
  return { source, window, availability, coverage, observationMode, required };
}
