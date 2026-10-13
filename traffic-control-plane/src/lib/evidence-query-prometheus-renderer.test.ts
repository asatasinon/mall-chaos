import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import {
  EvidencePrometheusRenderError,
  renderPrometheusEvidenceQuery,
  type EvidencePrometheusRenderErrorCode,
} from './evidence-query-prometheus-renderer';
import type { FixedPrometheusEvidenceTemplate } from './evidence-query-prometheus-renderer';
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

test('renders every Prometheus template declared by the Catalog', () => {
  const renderedTemplates = new Set<FixedPrometheusEvidenceTemplate>();

  for (const definition of listScenarioDefinitions()) {
    for (const recipe of definition.contract.evidence.recipes) {
      if (recipe.source !== 'PROMETHEUS') continue;
      const rendered = renderPrometheusEvidenceQuery(recipe);
      renderedTemplates.add(rendered.template);
      assert.ok(rendered.expression.includes(`service="${recipe.scope.service}"`));
      if (recipe.scope.route !== undefined) {
        assert.ok(rendered.expression.includes(`uri="${recipe.scope.route}"`));
      }
      assert.deepEqual(rendered.predicate, recipe.predicate);
    }
  }

  assert.deepEqual([...renderedTemplates].sort(), [
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
});

test('uses fixed metric families and time windows for the added templates', () => {
  const expressions: readonly [EvidenceRecipeDefinition, string][] = [
    [scenarioRecipe('BROWSE_REPORT_SQL', 'HTTP_P99'),
      'histogram_quantile(0.99, sum by (service, uri, le) '
      + '(rate(http_server_requests_seconds_bucket{service="catalog-service",uri="/api/reports/product-browse"}[5m])))'],
    [scenarioRecipe('CART_CATALOG_DEPENDENCY', 'HTTP_ERROR_RATIO'),
      'sum by (service, uri) '
      + '(rate(http_server_requests_seconds_count{service="cart-service",uri="/api/cart/items",status=~"5.."}[5m]))'
      + ' / sum by (service, uri) '
      + '(rate(http_server_requests_seconds_count{service="cart-service",uri="/api/cart/items"}[5m]))'],
    [scenarioRecipe('BROWSE_SURGE', 'HTTP_RATE'),
      'sum by (service, uri) '
      + '(rate(http_server_requests_seconds_count{service="gateway-service",uri="/api/products"}[5m]))'],
    [scenarioRecipe('ORDER_REPORT_SQL', 'HIKARI_UTILIZATION'),
      'sum by (service) (hikaricp_connections_active{service="order-service"})'
      + ' / sum by (service) (hikaricp_connections_max{service="order-service"})'],
    [scenarioRecipe('CATALOG_REDIS_LARGE_VALUE', 'JVM_HEAP_RATIO'),
      'sum by (service) (jvm_memory_used_bytes{service="catalog-service",area="heap"})'
      + ' / sum by (service) (jvm_memory_max_bytes{service="catalog-service",area="heap"})'],
    [scenarioRecipe('BROWSE_REPORT_SQL', 'MYSQL_SLOW_QUERY_RATE'),
      'sum by (service) (rate(mysql_global_status_slow_queries{service="mysql"}[5m]))'],
    [scenarioRecipe('CATALOG_REDIS_LARGE_VALUE', 'REDIS_MEMORY_RATIO'),
      'redis_memory_used_bytes{service="redis"} / redis_memory_max_bytes{service="redis"}'],
    [scenarioRecipe('NOTIFICATION_STORAGE_APPEND', 'NODE_FILESYSTEM_RATIO'),
      '1 - node_filesystem_avail_bytes{service="node",mountpoint="/data",fstype="ext4"}'
      + ' / node_filesystem_size_bytes{service="node",mountpoint="/data",fstype="ext4"}'],
  ];

  for (const [recipe, expected] of expressions) {
    assert.equal(renderPrometheusEvidenceQuery(recipe).expression, expected, recipe.template);
  }
});

test('escapes fixed route labels and rejects route values outside the Catalog path shape', () => {
  const recipe = catalogRecipe('HTTP_P99');
  const escaped = renderPrometheusEvidenceQuery({
    ...recipe,
    scope: { ...recipe.scope, route: '/api/"quoted' },
  });
  assert.ok(escaped.expression.includes('uri="/api/\\"quoted"'));
  assertRenderError({
    ...recipe,
    scope: { ...recipe.scope, route: '/api/products?sku=1' },
  }, 'INVALID_SCOPE');
});

test('rejects unsupported templates, sources, scope, and query semantics', () => {
  const paymentRecipe = catalogRecipe('PAYMENT_FAILURE_RATIO');
  const nodeRecipe = catalogRecipe('NODE_FILESYSTEM_GROWTH_RATE');

  assertRenderError({ ...paymentRecipe, template: 'SERVICE_EVENT_COUNT' }, 'UNSUPPORTED_TEMPLATE');
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
  const recipe = listScenarioDefinitions().flatMap(({ contract }) => contract.evidence.recipes)
    .find((candidate) => candidate.template === template && candidate.source === 'PROMETHEUS');
  if (!recipe) throw new Error(`EVIDENCE_FIXTURE_RECIPE_MISSING:${template}`);
  return recipe;
}

function scenarioRecipe(scenario: string, template: EvidenceTemplateId): EvidenceRecipeDefinition {
  const recipe = listScenarioDefinitions().find((definition) => definition.scenario === scenario)
    ?.contract.evidence.recipes.find((candidate) => candidate.template === template
      && candidate.source === 'PROMETHEUS');
  if (!recipe) throw new Error(`EVIDENCE_FIXTURE_RECIPE_MISSING:${scenario}:${template}`);
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
