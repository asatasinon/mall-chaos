import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';
import { resolveScenarioContract } from './scenario-contract';
import type { EvidenceResolvedWindow, RenderedEvidenceRecipe } from './evidence-types';
import {
  EvidenceQueryPreflightError,
  loadEvidenceDatabaseNow,
  preflightEvidenceQuery,
} from './evidence-query-preflight';

test('reads the MySQL clock exactly once and never substitutes a process clock', async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      return [[{ database_now: '2026-10-09 06:00:00.123' }], []];
    },
  } as unknown as Pool;
  assert.equal(await loadEvidenceDatabaseNow(pool), '2026-10-09T06:00:00.123Z');
  assert.deepEqual(queries, ['SELECT CURRENT_TIMESTAMP(3) AS database_now']);

  await assert.rejects(
    loadEvidenceDatabaseNow({
      async query() { return [[], []]; },
    } as unknown as Pool),
    (error: unknown) => error instanceof EvidenceQueryPreflightError
      && error.code === 'EVIDENCE_DATABASE_TIME_UNAVAILABLE',
  );
});

test('completely expired windows and unconfigured sources do not schedule a query', () => {
  const recipe = prometheusRecipe();
  const expired = preflightEvidenceQuery(recipe, readyWindow(
    '2026-10-09T05:00:00.000Z',
    '2026-10-09T05:05:00.000Z',
  ), { baseUrl: 'http://prometheus.internal', retentionSec: 3000 }, '2026-10-09T06:00:00.000Z');
  assert.equal(expired.shouldQuery, false);
  assert.equal(expired.availabilityHint, 'EVIDENCE_UNAVAILABLE');
  assert.equal(expired.coverageHint, 'NONE');
  assert.deepEqual(expired.reasonCodes, ['RETENTION_EXPIRED']);

  const unconfigured = preflightEvidenceQuery(recipe, readyWindow(
    '2026-10-09T05:50:00.000Z',
    '2026-10-09T05:55:00.000Z',
  ), { baseUrl: null, retentionSec: 604_800 }, '2026-10-09T06:00:00.000Z');
  assert.equal(unconfigured.shouldQuery, false);
  assert.equal(unconfigured.availabilityHint, 'EVIDENCE_UNAVAILABLE');
  assert.deepEqual(unconfigured.reasonCodes, ['SOURCE_UNCONFIGURED']);
});

test('lookback retention limits actual execution range without mutating canonical bounds', () => {
  const recipe = prometheusRecipe();
  const window = readyWindow('2026-10-09T05:00:00.000Z', '2026-10-09T05:10:00.000Z');
  const result = preflightEvidenceQuery(
    recipe,
    window,
    { baseUrl: 'http://prometheus.internal', retentionSec: 3600 },
    '2026-10-09T06:00:00.000Z',
  );

  assert.equal(result.shouldQuery, true);
  assert.equal(result.canonicalStartAt, window.canonicalStartAt);
  assert.equal(result.canonicalEndAt, window.canonicalEndAt);
  assert.equal(result.executedStartAt, '2026-10-09T05:05:00.000Z');
  assert.equal(result.executedEndAt, window.canonicalEndAt);
  assert.equal(result.coverageHint, 'PARTIAL');
  assert.equal(result.predicateOutcome, 'INCONCLUSIVE');
  assert.deepEqual(result.reasonCodes, ['RETENTION_LOOKBACK_PARTIAL']);
});

test('fully retained lookback input leaves full query scope eligible', () => {
  const recipe = prometheusRecipe();
  const window = readyWindow('2026-10-09T05:10:00.000Z', '2026-10-09T05:15:00.000Z');
  const result = preflightEvidenceQuery(
    recipe,
    window,
    { baseUrl: 'http://prometheus.internal', retentionSec: 3600 },
    '2026-10-09T06:00:00.000Z',
  );
  assert.equal(result.shouldQuery, true);
  assert.equal(result.executedStartAt, window.canonicalStartAt);
  assert.equal(result.executedEndAt, window.canonicalEndAt);
  assert.equal(result.coverageHint, null);
  assert.equal(result.predicateOutcome, null);
  assert.deepEqual(result.reasonCodes, []);
});

test('future tails execute only reached input-ready ranges and stay partial/inconclusive', () => {
  const recipe = prometheusRecipe();
  const window = readyWindow('2026-10-09T05:00:00.000Z', '2026-10-09T06:05:00.000Z');
  const result = preflightEvidenceQuery(
    recipe,
    window,
    { baseUrl: 'http://prometheus.internal', retentionSec: 604_800 },
    '2026-10-09T06:00:00.000Z',
  );
  assert.equal(result.shouldQuery, true);
  assert.equal(result.executedStartAt, window.canonicalStartAt);
  assert.equal(result.executedEndAt, '2026-10-09T06:00:00.000Z');
  assert.equal(result.canonicalEndAt, window.canonicalEndAt);
  assert.equal(result.windowSettled, false);
  assert.equal(result.coverageHint, 'PARTIAL');
  assert.equal(result.predicateOutcome, 'INCONCLUSIVE');
  assert.deepEqual(result.reasonCodes, ['WINDOW_NOT_SETTLED']);

  const noRangeYet = preflightEvidenceQuery(
    recipe,
    readyWindow('2026-10-09T06:01:00.000Z', '2026-10-09T06:05:00.000Z'),
    { baseUrl: 'http://prometheus.internal', retentionSec: 604_800 },
    '2026-10-09T06:00:00.000Z',
  );
  assert.equal(noRangeYet.shouldQuery, false);
  assert.equal(noRangeYet.executedStartAt, null);
  assert.deepEqual(noRangeYet.reasonCodes, ['WINDOW_NOT_SETTLED']);
});

test('invalid query sources or non-ready windows fail closed without rewriting their reason', () => {
  const recipe = prometheusRecipe();
  const notReady: EvidenceResolvedWindow = {
    name: 'active',
    state: 'NOT_READY',
    canonicalStartAt: null,
    canonicalEndAt: null,
    reasonCode: 'ACTIVE_BOUNDARY_MISSING',
  };
  const result = preflightEvidenceQuery(
    recipe,
    notReady,
    { baseUrl: 'http://prometheus.internal', retentionSec: 604_800 },
    '2026-10-09T06:00:00.000Z',
  );
  assert.equal(result.shouldQuery, false);
  assert.deepEqual(result.reasonCodes, ['ACTIVE_BOUNDARY_MISSING']);
  assert.throws(
    () => preflightEvidenceQuery({
      ...recipe,
      source: 'RESOURCE_CHECK',
    } as RenderedEvidenceRecipe, readyWindow('2026-10-09T05:00:00.000Z', '2026-10-09T05:05:00.000Z'),
    { baseUrl: 'http://prometheus.internal', retentionSec: 604_800 },
    '2026-10-09T06:00:00.000Z'),
    (error: unknown) => error instanceof EvidenceQueryPreflightError
      && error.code === 'EVIDENCE_QUERY_PREFLIGHT_INVALID_RECIPE',
  );
});

function prometheusRecipe(): RenderedEvidenceRecipe {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'ORDER_QUERY_SURGE')!;
  const contract = resolveScenarioContract(definition);
  const plan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const recipe = plan.recipes.find((candidate) =>
    candidate.source === 'PROMETHEUS' && candidate.template === 'HTTP_P99' && candidate.window === 'active');
  if (!recipe) throw new Error('PROMETHEUS_TEST_RECIPE_MISSING');
  return recipe;
}

function readyWindow(startAt: string, endAt: string): EvidenceResolvedWindow {
  return {
    name: 'active',
    state: 'READY',
    canonicalStartAt: startAt,
    canonicalEndAt: endAt,
    reasonCode: null,
  };
}
