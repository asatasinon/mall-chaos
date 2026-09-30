import assert from 'node:assert/strict';
import test from 'node:test';
import { listScenarioDefinitions } from '../lib/fault-run-catalog';
import { SCENARIO_GROUPS, SCENARIO_META } from '../components/scenarios/meta';
import messages from './messages';

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce<Record<string, string>>((result, [key, child]) => ({
    ...result,
    ...flatten(child, prefix ? `${prefix}.${key}` : key),
  }), {});
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

function nestedValue(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => (
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)[key]
      : undefined
  ), value);
}

test('English and Simplified Chinese catalogs have identical keys', () => {
  const englishKeys = Object.keys(flatten(messages.en)).sort();
  const chineseKeys = Object.keys(flatten(messages['zh-CN'])).sort();

  assert.deepEqual(chineseKeys, englishKeys);
  assert.ok(englishKeys.length > 600);
});

test('catalog placeholders and required namespaces stay aligned', () => {
  const english = flatten(messages.en);
  const chinese = flatten(messages['zh-CN']);

  for (const key of Object.keys(english)) {
    assert.deepEqual(placeholders(chinese[key]), placeholders(english[key]), key);
  }

  for (const key of [
    'Common.cancel',
    'Navigation.runner',
    'Navigation.runbook',
    'Scenarios.networkError',
    'Scenarios.recoveryStrategies.TARGET',
    'Runner.runnerViews',
    'Operations.clearSelectedPartitions',
    'Alerts.newAlert',
    'Accessibility.chooseDate',
    'Runbook.pageTitle',
    'Runbook.tempoTitle',
    'Runbook.mermaidError',
  ]) {
    assert.equal(typeof english[key], 'string', key);
    assert.equal(typeof chinese[key], 'string', key);
  }
});

test('scenario, parameter, recovery, and group translations cover the Catalog exactly', () => {
  const definitions = listScenarioDefinitions();
  const scenarios = definitions.map(({ scenario }) => scenario).sort();
  const parameterNames = [...new Set(definitions.flatMap(({ parameters }) => (
    parameters.map(({ name }) => name)
  )))].sort();
  const recoveryStrategies = [...new Set(definitions.map(({ recoveryStrategy }) => (
    recoveryStrategy
  )))].sort();
  const groupedScenarios = SCENARIO_GROUPS.flatMap(({ scenarios: members }) => members);

  assert.deepEqual(Object.keys(SCENARIO_META).sort(), scenarios);
  assert.equal(new Set(groupedScenarios).size, groupedScenarios.length);
  assert.deepEqual([...groupedScenarios].sort(), scenarios);

  for (const locale of ['en', 'zh-CN'] as const) {
    const scenarioMessages = messages[locale].Scenarios;
    const scenarioMeta = scenarioMessages.scenarioMeta as Record<string, unknown>;
    const parameters = scenarioMessages.parameters as Record<string, unknown>;
    const recoveryLabels = scenarioMessages.recoveryStrategies as Record<string, unknown>;
    const groupLabels = scenarioMessages.groups as Record<string, unknown>;

    assert.deepEqual(Object.keys(scenarioMeta).sort(), scenarios, `${locale}:scenarioMeta`);
    assert.deepEqual(Object.keys(parameters).sort(), parameterNames, `${locale}:parameters`);
    assert.deepEqual(Object.keys(recoveryLabels).sort(), recoveryStrategies, `${locale}:recoveryStrategies`);

    for (const definition of definitions) {
      const scenarioMetaEntry = scenarioMeta[definition.scenario];
      const displayMeta = SCENARIO_META[definition.scenario];
      assert.ok(displayMeta, `${locale}:${definition.scenario}:display metadata`);
      assert.equal(displayMeta.labelKey, definition.scenario, `${locale}:${definition.scenario}:label key`);
      assert.equal(displayMeta.descriptionKey, definition.scenario, `${locale}:${definition.scenario}:description key`);
      for (const field of ['label', 'description'] as const) {
        const value = nestedValue(scenarioMetaEntry, [field]);
        assert.ok(typeof value === 'string', `${locale}:scenarioMeta.${definition.scenario}.${field}`);
        assert.notEqual(value.trim(), '', `${locale}:scenarioMeta.${definition.scenario}.${field}`);
      }

      const recoveryLabel = recoveryLabels[definition.recoveryStrategy];
      assert.ok(typeof recoveryLabel === 'string', `${locale}:recoveryStrategies.${definition.recoveryStrategy}`);
      assert.notEqual(recoveryLabel.trim(), '', `${locale}:recoveryStrategies.${definition.recoveryStrategy}`);
      for (const { name } of definition.parameters) {
        for (const field of ['label', 'description'] as const) {
          const value = nestedValue(parameters[name], [field]);
          assert.ok(typeof value === 'string', `${locale}:parameters.${name}.${field}`);
          assert.notEqual(value.trim(), '', `${locale}:parameters.${name}.${field}`);
        }
      }
    }

    for (const { labelKey } of SCENARIO_GROUPS) {
      const label = groupLabels[labelKey];
      assert.ok(typeof label === 'string', `${locale}:groups.${labelKey}`);
      assert.notEqual(label.trim(), '', `${locale}:groups.${labelKey}`);
    }
  }
});