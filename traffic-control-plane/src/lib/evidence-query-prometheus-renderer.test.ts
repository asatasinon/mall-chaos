import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getScenarioDefinition } from './fault-run-catalog';
import {
  EvidencePrometheusRenderError,
  renderPrometheusEvidenceQuery,
  type EvidencePrometheusRenderErrorCode,
} from './evidence-query-prometheus-renderer';
import type {
  EvidenceRecipeDefinition,
  EvidenceTemplateId,
} from './scenario-contract';

interface PrometheusMetricFixture {
  readonly meterName?: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly matchers: Readonly<Record<string, string>>;
  readonly samples: readonly number[];
}

const METRIC_FIXTURES: Readonly<Record<
  'PAYMENT_FAILURE_RATIO' | 'PAYMENT_TIMEOUT_RATE' | 'NODE_FILESYSTEM_GROWTH_RATE',
  readonly PrometheusMetricFixture[]
>> = {
  PAYMENT_FAILURE_RATIO: [
    {
      meterName: 'payment.charge.fail.count',
      name: 'payment_charge_fail_count_total',
      labels: { service: 'payment-service' },
      matchers: { service: 'payment-service' },
      samples: [4, 9],
    },
    {
      meterName: 'payment.charge.success.count',
      name: 'payment_charge_success_count_total',
      labels: { service: 'payment-service' },
      matchers: { service: 'payment-service' },
      samples: [80, 120],
    },
  ],
  PAYMENT_TIMEOUT_RATE: [
    {
      meterName: 'payment.charge.timeout.count',
      name: 'payment_charge_timeout_count_total',
      labels: { service: 'payment-service' },
      matchers: { service: 'payment-service' },
      samples: [0, 3],
    },
  ],
  NODE_FILESYSTEM_GROWTH_RATE: [
    {
      name: 'node_filesystem_avail_bytes',
      labels: {
        service: 'node',
        mountpoint: '/data',
        fstype: 'ext4',
        device: '/dev/test-data',
      },
      matchers: { service: 'node', mountpoint: '/data', fstype: 'ext4' },
      samples: [20 * 1024 ** 3, 18 * 1024 ** 3],
    },
  ],
};

test('renders payment failure ratio from fixed payment counters and the Catalog predicate', () => {
  const recipe = catalogRecipe('PAYMENT_FAILURE_RATIO');
  const rendered = renderPrometheusEvidenceQuery(recipe);

  assert.equal(
    rendered.expression,
    'rate(payment_charge_fail_count_total{service="payment-service"}[5m])'
      + ' / (rate(payment_charge_success_count_total{service="payment-service"}[5m])'
      + ' + rate(payment_charge_fail_count_total{service="payment-service"}[5m]))',
  );
  assert.equal(rendered.window, recipe.window);
  assert.deepEqual(rendered.predicate, recipe.predicate);
  assertFixturesReferenced(rendered.expression, METRIC_FIXTURES.PAYMENT_FAILURE_RATIO);
  assert.ok(METRIC_FIXTURES.PAYMENT_FAILURE_RATIO.every(({ meterName }) => meterName !== undefined));
});

test('renders payment timeout rate using the fixed five-minute counter rate', () => {
  const recipe = catalogRecipe('PAYMENT_TIMEOUT_RATE');
  const rendered = renderPrometheusEvidenceQuery(recipe);

  assert.equal(
    rendered.expression,
    'rate(payment_charge_timeout_count_total{service="payment-service"}[5m])',
  );
  assert.equal(rendered.window, recipe.window);
  assert.deepEqual(rendered.predicate, recipe.predicate);
  assertFixturesReferenced(rendered.expression, METRIC_FIXTURES.PAYMENT_TIMEOUT_RATE);
});

test('renders filesystem growth only for the fixed /data ext4 series and fifteen-minute deriv', () => {
  const recipe = catalogRecipe('NODE_FILESYSTEM_GROWTH_RATE');
  const rendered = renderPrometheusEvidenceQuery(recipe);

  assert.equal(
    rendered.expression,
    'deriv(node_filesystem_avail_bytes{service="node",mountpoint="/data",fstype="ext4"}[15m])',
  );
  assert.equal(rendered.window, recipe.window);
  assert.deepEqual(rendered.predicate, recipe.predicate);
  assertFixturesReferenced(rendered.expression, METRIC_FIXTURES.NODE_FILESYSTEM_GROWTH_RATE);
  assert.ok(!rendered.expression.includes('device='));
});

test('rejects unsupported templates, sources, scope, and query semantics', () => {
  const paymentRecipe = catalogRecipe('PAYMENT_FAILURE_RATIO');
  const nodeRecipe = catalogRecipe('NODE_FILESYSTEM_GROWTH_RATE');

  assertRenderError({ ...paymentRecipe, template: 'HTTP_P99' }, 'UNSUPPORTED_TEMPLATE');
  assertRenderError({ ...paymentRecipe, source: 'TEMPO' }, 'UNSUPPORTED_SOURCE');
  assertRenderError({
    ...paymentRecipe,
    scope: { ...paymentRecipe.scope, route: '/unapproved' },
  }, 'INVALID_SCOPE');
  assertRenderError({
    ...nodeRecipe,
    scope: {
      ...nodeRecipe.scope,
      fixedLabels: { ...nodeRecipe.scope.fixedLabels, mountpoint: '"/] or vector(1)' },
    },
  }, 'INVALID_SCOPE');
  assertRenderError({ ...paymentRecipe, observationMode: 'CURRENT' }, 'INVALID_RECIPE');
});

function catalogRecipe(template: EvidenceTemplateId): EvidenceRecipeDefinition {
  const scenario = template === 'NODE_FILESYSTEM_GROWTH_RATE'
    ? 'NOTIFICATION_STORAGE_APPEND'
    : 'PSP_PROVIDER_OUTCOME';
  const recipe = getScenarioDefinition(scenario).contract.evidence.recipes.find(
    (candidate) => candidate.template === template,
  );
  if (!recipe) throw new Error(`EVIDENCE_FIXTURE_RECIPE_MISSING:${template}`);
  return recipe;
}

function assertFixturesReferenced(
  expression: string,
  fixtures: readonly PrometheusMetricFixture[],
): void {
  for (const fixture of fixtures) {
    assert.ok(expression.includes(fixture.name), `Expected ${fixture.name} in rendered expression`);
    for (const [name, value] of Object.entries(fixture.matchers)) {
      assert.ok(expression.includes(`${name}="${value}"`), `Expected fixed label ${name}`);
    }
    assert.ok(fixture.samples.length >= 2);
  }
}

function assertRenderError(
  recipe: EvidenceRecipeDefinition,
  code: EvidencePrometheusRenderErrorCode,
): void {
  assert.throws(
    () => renderPrometheusEvidenceQuery(recipe),
    (error: unknown) => error instanceof EvidencePrometheusRenderError && error.code === code,
  );
}
