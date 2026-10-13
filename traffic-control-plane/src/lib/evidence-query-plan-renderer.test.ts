import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import {
  EVIDENCE_EVALUATION_REVISION,
  EVIDENCE_RENDERER_REVISION,
  EvidencePlanRenderError,
  renderEvidenceQueryPlan,
  renderTempoEvidenceQuery,
} from './evidence-query-plan-renderer';
import {
  createEvidenceCaptureSnapshot,
  canonicalizeEvidenceRenderedPlan,
  isEvidenceRenderedPlan,
  parseEvidenceCaptureSnapshot,
  serializeEvidenceCaptureSnapshot,
} from './evidence-types';
import {
  getScenarioContractRevision,
  resolveScenarioContract,
  type EvidenceContractPlan,
} from './scenario-contract';

test('renders all Catalog plans with frozen source protocols and stable revisions', () => {
  assert.equal(listScenarioDefinitions().length, 12);
  const templatesBySource = new Map<string, Set<string>>();

  for (const definition of listScenarioDefinitions()) {
    const limits = {
      baseline: 900,
      active: definition.maxDurationSec + 60,
      recovery: 2100,
      cleanup: 600,
    };
    const plan = renderEvidenceQueryPlan(definition.contract.evidence, limits);
    assert.equal(plan.rendererRevision, EVIDENCE_RENDERER_REVISION);
    assert.equal(plan.evaluationRevision, EVIDENCE_EVALUATION_REVISION);
    assert.deepEqual(plan.windowLimits, limits);
    assert.equal(isEvidenceRenderedPlan(plan), true, definition.scenario);
    assert.ok(plan.recipes.every(({ renderedQuery }) =>
      renderedQuery === null || renderedQuery.length > 0));

    for (const recipe of plan.recipes) {
      const templates = templatesBySource.get(recipe.source) ?? new Set<string>();
      templates.add(recipe.template);
      templatesBySource.set(recipe.source, templates);
    }
  }

  assert.deepEqual([...templatesBySource.get('PROMETHEUS') ?? []].sort(), [
    'HIKARI_UTILIZATION',
    'HTTP_ERROR_RATIO',
    'HTTP_P99',
    'HTTP_RATE',
    'JVM_HEAP_RATIO',
    'MYSQL_SLOW_QUERY_RATE',
    'NODE_FILESYSTEM_GROWTH_RATE',
    'NODE_FILESYSTEM_RATIO',
    'PAYMENT_FAILURE_RATIO',
    'PAYMENT_TIMEOUT_RATE',
    'REDIS_MEMORY_RATIO',
  ]);
  assert.deepEqual([...templatesBySource.get('LOKI') ?? []], ['SERVICE_ERROR_COUNT']);
  assert.deepEqual([...templatesBySource.get('TEMPO') ?? []].sort(), [
    'SERVICE_ROUTE_REQUESTS',
    'SERVICE_SLOW_REQUESTS',
  ]);
});

test('capture snapshots retain exact rendered plans and their independent hashes for all scenarios', () => {
  for (const definition of listScenarioDefinitions()) {
    const contract = resolveScenarioContract(definition);
    const plan = renderEvidenceQueryPlan(contract.evidence, {
      baseline: 900,
      active: contract.maxDurationSec + 60,
      recovery: 2100,
      cleanup: 600,
    });
    const snapshot = createEvidenceCaptureSnapshot(
      getScenarioContractRevision(contract),
      contract.evidence,
      plan,
    );
    const serialized = serializeEvidenceCaptureSnapshot(snapshot);
    const parsed = parseEvidenceCaptureSnapshot(serialized);

    assert.equal(parsed.contractRevision, getScenarioContractRevision(contract));
    assert.equal(parsed.contractHash, snapshot.contractHash);
    assert.equal(parsed.renderedPlanHash, snapshot.renderedPlanHash);
    assert.equal(parsed.renderedPlan.rendererRevision, EVIDENCE_RENDERER_REVISION);
    assert.equal(parsed.renderedPlan.evaluationRevision, EVIDENCE_EVALUATION_REVISION);
    assert.equal(
      canonicalizeEvidenceRenderedPlan(parsed.renderedPlan),
      canonicalizeEvidenceRenderedPlan(plan),
    );
  }
});

test('derives baseline rows from active windowed telemetry without changing their frozen query', () => {
  for (const definition of listScenarioDefinitions()) {
    const plan = renderEvidenceQueryPlan(definition.contract.evidence, {
      baseline: 900,
      active: definition.maxDurationSec + 60,
      recovery: 2100,
      cleanup: 600,
    });
    const activeRecipes = plan.recipes.filter((recipe) =>
      recipe.window === 'active' && recipe.observationMode === 'WINDOWED'
      && ['PROMETHEUS', 'LOKI', 'TEMPO'].includes(recipe.source));
    const baselineRecipes = plan.recipes.filter((recipe) => recipe.window === 'baseline');

    assert.equal(baselineRecipes.length, activeRecipes.length, definition.scenario);
    for (const active of activeRecipes) {
      const baseline = baselineRecipes.find((recipe) => recipe.recipeId === active.recipeId);
      assert.ok(baseline, `${definition.scenario}:${active.recipeId}`);
      assert.equal(baseline.baselineForRecipeId, active.recipeId);
      assert.equal(baseline.renderedQuery, active.renderedQuery);
      assert.equal(baseline.scopeMode, active.scopeMode);
      assert.equal(baseline.required, false);
      assert.equal(baseline.aggregation, 'BASELINE_SUMMARY');
      assert.equal(baseline.predicate.kind, 'NONE');
    }
    assert.equal(baselineRecipes.some((recipe) =>
      recipe.source === 'BUSINESS_CHECK' || recipe.source === 'RUN_EVENT'), false);
  }
});

test('Loki plans declare service-only scope and use only indexed stream labels', () => {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'BROWSE_REPORT_SQL');
  assert.ok(definition);
  const plan = renderEvidenceQueryPlan(definition.contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const loki = plan.recipes.find((recipe) => recipe.source === 'LOKI' && recipe.window === 'active');
  assert.ok(loki);
  assert.equal(loki.scopeMode, 'SERVICE_ONLY');
  assert.equal(
    loki.renderedQuery,
    'sum(count_over_time({service="catalog-service",log_level=~"ERROR|FATAL"}[1m]))',
  );
  assert.equal(loki.renderedQuery?.includes('/api/reports/product-browse'), false);
  assert.equal(
    definition.contract.evidence.effectRule.recipeIds.includes(loki.recipeId),
    false,
  );
});

test('TraceQL slow-duration thresholds stay in the query while predicates compare count presence', () => {
  for (const definition of listScenarioDefinitions()) {
    const plan = renderEvidenceQueryPlan(definition.contract.evidence, {
      baseline: 900,
      active: definition.maxDurationSec + 60,
      recovery: 2100,
      cleanup: 600,
    });
    for (const recipe of plan.recipes.filter((candidate) =>
      candidate.source === 'TEMPO' && candidate.template === 'SERVICE_SLOW_REQUESTS'
      && candidate.window !== 'baseline')) {
      assert.match(recipe.renderedQuery ?? '', /duration (?:>|>=|<|<=|=) /u);
      assert.equal(recipe.valueUnit, 'count');
      assert.deepEqual(recipe.predicate, { kind: 'COMPARISON', operator: 'GT', value: 0 });
    }
  }
});

test('freezes each lookback to the query window used by its template', () => {
  const definition = listScenarioDefinitions().find(({ scenario }) =>
    scenario === 'NOTIFICATION_STORAGE_APPEND');
  assert.ok(definition);
  const plan = renderEvidenceQueryPlan(definition.contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  assert.equal(plan.recipes.find((recipe) =>
    recipe.template === 'NODE_FILESYSTEM_GROWTH_RATE')?.lookbackSec, 900);
  assert.equal(plan.recipes.find((recipe) =>
    recipe.template === 'NODE_FILESYSTEM_RATIO')?.lookbackSec, 0);
  assert.equal(plan.recipes.find((recipe) => recipe.source === 'LOKI')?.lookbackSec, 60);
});

test('TraceQL selectors escape fixed values and reject unsafe scope input', () => {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'BROWSE_REPORT_SQL');
  assert.ok(definition);
  const recipe = definition.contract.evidence.recipes.find((candidate) =>
    candidate.source === 'TEMPO' && candidate.template === 'SERVICE_SLOW_REQUESTS');
  assert.ok(recipe);
  const route = '/api/"quoted';
  const escaped = renderTempoEvidenceQuery({
    ...recipe,
    scope: { ...recipe.scope, route },
  });
  assert.ok(escaped.includes(`span.http.route = ${JSON.stringify(route)}`));
  assert.throws(
    () => renderTempoEvidenceQuery({
      ...recipe,
      scope: { ...recipe.scope, service: 'svc" || true' },
    }),
    /EVIDENCE_PLAN_RENDER_INVALID_RECIPE/u,
  );
  assert.throws(
    () => renderTempoEvidenceQuery({
      ...recipe,
      scope: { ...recipe.scope, route: '/api/products?sku=1' },
    }),
    /EVIDENCE_PLAN_RENDER_INVALID_RECIPE/u,
  );
});

test('CURRENT checks and event timelines remain typed non-query recipes', () => {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'BROWSE_REPORT_SQL');
  assert.ok(definition);
  const plan = renderEvidenceQueryPlan(definition.contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const current = plan.recipes.find((recipe) => recipe.source === 'BUSINESS_CHECK');
  const timeline = plan.recipes.find((recipe) => recipe.source === 'RUN_EVENT');
  assert.ok(current);
  assert.equal(current.observationMode, 'CURRENT');
  assert.equal(current.window, 'recovery');
  assert.equal(current.renderedQuery, null);
  assert.equal(current.businessCheckId, 'CATALOG_BROWSE_REPORT');
  assert.ok(timeline);
  assert.equal(timeline.renderedQuery, null);
  assert.equal(timeline.aggregation, 'TIMELINE');
});

test('rejects unsupported source protocols and invalid window budgets explicitly', () => {
  const definition = listScenarioDefinitions()[0]!;
  const unsupported = structuredClone(definition.contract.evidence) as EvidenceContractPlan;
  const firstPrometheusIndex = unsupported.recipes.findIndex((recipe) => recipe.source === 'PROMETHEUS');
  assert.notEqual(firstPrometheusIndex, -1);
  const changedRecipes = [...unsupported.recipes];
  changedRecipes[firstPrometheusIndex] = {
    ...changedRecipes[firstPrometheusIndex]!,
    source: 'RESOURCE_CHECK',
  };
  const contract = { ...unsupported, recipes: changedRecipes } as EvidenceContractPlan;
  assert.throws(
    () => renderEvidenceQueryPlan(contract, {
      baseline: 900, active: 3660, recovery: 2100, cleanup: 600,
    }),
    (error: unknown) => error instanceof EvidencePlanRenderError
      && error.code === 'UNSUPPORTED_SOURCE',
  );
  assert.throws(
    () => renderEvidenceQueryPlan(definition.contract.evidence, {
      baseline: 0, active: 3660, recovery: 2100, cleanup: 600,
    }),
    (error: unknown) => error instanceof EvidencePlanRenderError
      && error.code === 'INVALID_WINDOW_LIMITS',
  );
});
