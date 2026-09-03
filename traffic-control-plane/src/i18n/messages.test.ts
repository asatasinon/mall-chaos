import assert from 'node:assert/strict';
import test from 'node:test';
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