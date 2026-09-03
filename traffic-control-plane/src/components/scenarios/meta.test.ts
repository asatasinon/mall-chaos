import assert from 'node:assert/strict';
import test from 'node:test';
import messages from '../../i18n/messages';
import {
  getProviderOutcomeLabel,
  getRecoveryStrategyLabel,
  getScenarioGroupLabel,
  getScenarioLabel,
  getScenarioStateLabel,
  PROVIDER_OUTCOMES,
  SCENARIO_GROUPS,
  SCENARIO_META,
} from './meta';

function translate(key: string): string {
  const value = key.split('.').reduce<unknown>((current, segment) => (
    current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined
  ), messages['zh-CN'].Scenarios);
  if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`);
  return value;
}

test('all scenario, group, provider, state, and recovery displays have Chinese labels', () => {
  for (const scenario of Object.keys(SCENARIO_META)) {
    assert.notEqual(getScenarioLabel(scenario, translate), scenario);
  }
  for (const group of SCENARIO_GROUPS) {
    assert.notEqual(getScenarioGroupLabel(group, translate), group.labelKey);
  }
  for (const outcome of PROVIDER_OUTCOMES) {
    assert.notEqual(getProviderOutcomeLabel(outcome.value, translate), outcome.value);
  }
  for (const state of ['CREATING', 'ACTIVE', 'RECOVERED', 'FAILED']) {
    assert.notEqual(getScenarioStateLabel(state, translate), state);
  }
  for (const strategy of ['TARGET', 'WORKER', 'NON_RELEASING', 'MANUAL_CLEANUP']) {
    assert.notEqual(getRecoveryStrategyLabel(strategy, translate), strategy);
  }
});

test('unknown stable values fall back without throwing', () => {
  assert.equal(getScenarioLabel('UNKNOWN_SCENARIO', translate), 'UNKNOWN_SCENARIO');
  assert.equal(getProviderOutcomeLabel('UNKNOWN_OUTCOME', translate), 'UNKNOWN_OUTCOME');
  assert.equal(getScenarioStateLabel('UNKNOWN_STATE', translate), 'UNKNOWN_STATE');
  assert.equal(getRecoveryStrategyLabel('UNKNOWN_STRATEGY', translate), 'UNKNOWN_STRATEGY');
});