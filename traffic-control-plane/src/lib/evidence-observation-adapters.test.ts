import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import { resolveScenarioContract } from './scenario-contract';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';
import { resolveEvidenceWindows } from './evidence-window-resolver';
import {
  adaptCurrentBusinessCheckObservation,
  adaptRunTimelineObservation,
  EvidenceObservationAdapterError,
} from './evidence-observation-adapters';
import type { EvidenceTimeline } from './evidence-types';
import type { EvidenceBusinessCheckResult } from './evidence-business-checks';

test('Run Event evidence exposes only the safe timeline and never assesses effect', () => {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'BROWSE_REPORT_SQL')!;
  const contract = resolveScenarioContract(definition);
  const rendered = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const recipe = rendered.recipes.find((candidate) =>
    candidate.source === 'RUN_EVENT' && candidate.window === 'active')!;
  const timeline: EvidenceTimeline = {
    createdAt: '2026-10-09T05:00:00.000Z',
    prepareStartedAt: null,
    activeAt: '2026-10-09T05:01:00.000Z',
    stopRequestedAt: null,
    recoveryStartedAt: null,
    recoveredAt: null,
    cleanupFinishedAt: null,
    terminalAt: null,
    terminalState: null,
  };
  const windows = resolveEvidenceWindows(contract.evidence, timeline, rendered.windowLimits);
  const activeWindow = windows.windows.find((window) => window.name === 'active')!;
  const observation = adaptRunTimelineObservation(
    recipe,
    activeWindow,
    timeline,
    contract.evidence.effectRule.recipeIds,
  );

  assert.equal(observation.source, 'RUN_EVENT');
  assert.equal(observation.windowState, 'NOT_READY');
  assert.equal(observation.predicateOutcome, 'INCONCLUSIVE');
  assert.equal(observation.effectRuleEligible, false);
  assert.deepEqual(observation.timeline, timeline);
  assert.equal('payload' in observation, false);
  assert.equal('queryResult' in observation, false);
});

test('CURRENT business checks retain checkedAt and stay separate from historical/effect evidence', () => {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'BROWSE_REPORT_SQL')!;
  const contract = resolveScenarioContract(definition);
  const rendered = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const recipe = rendered.recipes.find((candidate) => candidate.source === 'BUSINESS_CHECK')!;
  const result: EvidenceBusinessCheckResult = {
    source: 'BUSINESS_CHECK',
    recipeId: recipe.recipeId,
    businessCheckId: 'CATALOG_BROWSE_REPORT',
    status: 'PASS',
    checkedAt: '2026-10-09T06:00:00.000Z',
    reasonCode: null,
  };

  const observation = adaptCurrentBusinessCheckObservation(
    recipe,
    result,
    contract.evidence.effectRule.recipeIds,
  );
  assert.equal(observation.window, 'recovery');
  assert.equal(observation.observationMode, 'CURRENT');
  assert.equal(observation.isHistorical, false);
  assert.equal(observation.checkedAt, result.checkedAt);
  assert.equal(observation.status, 'PASS');
  assert.equal(observation.effectRuleEligible, false);
  assert.equal('renderedQuery' in observation, false);
});

test('Run Event and CURRENT recipes are rejected if an effect rule includes them', () => {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'BROWSE_REPORT_SQL')!;
  const contract = resolveScenarioContract(definition);
  const rendered = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const timeline: EvidenceTimeline = {
    createdAt: '2026-10-09T05:00:00.000Z',
    prepareStartedAt: null,
    activeAt: null,
    stopRequestedAt: null,
    recoveryStartedAt: null,
    recoveredAt: null,
    cleanupFinishedAt: null,
    terminalAt: null,
    terminalState: null,
  };
  const activeWindow = resolveEvidenceWindows(contract.evidence, timeline, rendered.windowLimits)
    .windows.find((window) => window.name === 'active')!;
  const runEvent = rendered.recipes.find((recipe) =>
    recipe.source === 'RUN_EVENT' && recipe.window === 'active')!;
  const current = rendered.recipes.find((recipe) => recipe.source === 'BUSINESS_CHECK')!;

  for (const recipe of [runEvent, current]) {
    assert.throws(
      () => (recipe.source === 'RUN_EVENT'
        ? adaptRunTimelineObservation(recipe, activeWindow, timeline, [recipe.recipeId])
        : adaptCurrentBusinessCheckObservation(recipe, {
          source: 'BUSINESS_CHECK',
          recipeId: recipe.recipeId,
          businessCheckId: 'CATALOG_BROWSE_REPORT',
          status: 'PASS',
          checkedAt: '2026-10-09T06:00:00.000Z',
          reasonCode: null,
        }, [recipe.recipeId])),
      (error: unknown) => error instanceof EvidenceObservationAdapterError
        && error.code === 'EVIDENCE_OBSERVATION_EFFECT_RULE_VIOLATION',
    );
  }
});
