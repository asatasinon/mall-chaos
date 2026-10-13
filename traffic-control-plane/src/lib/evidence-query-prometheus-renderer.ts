import type {
  EvidencePredicate,
  EvidenceRecipeDefinition,
  EvidenceTemplateId,
} from './scenario-contract';
import { EVIDENCE_WINDOW_VALUES } from './scenario-contract';

export type FixedPrometheusEvidenceTemplate = Extract<
  EvidenceTemplateId,
  | 'HTTP_P99'
  | 'HTTP_ERROR_RATIO'
  | 'HTTP_RATE'
  | 'HIKARI_UTILIZATION'
  | 'JVM_HEAP_RATIO'
  | 'MYSQL_SLOW_QUERY_RATE'
  | 'PAYMENT_FAILURE_RATIO'
  | 'PAYMENT_TIMEOUT_RATE'
  | 'REDIS_MEMORY_RATIO'
  | 'NODE_FILESYSTEM_RATIO'
  | 'NODE_FILESYSTEM_GROWTH_RATE'
>;

type ComparisonPredicate = Extract<EvidencePredicate, { readonly kind: 'COMPARISON' }>;

export interface RenderedPrometheusEvidenceQuery {
  readonly source: 'PROMETHEUS';
  readonly template: FixedPrometheusEvidenceTemplate;
  readonly expression: string;
  readonly window: EvidenceRecipeDefinition['window'];
  readonly predicate: ComparisonPredicate;
  readonly projection: 'NUMERIC';
}

export type EvidencePrometheusRenderErrorCode =
  | 'UNSUPPORTED_SOURCE'
  | 'UNSUPPORTED_TEMPLATE'
  | 'INVALID_RECIPE'
  | 'INVALID_SCOPE';

export class EvidencePrometheusRenderError extends Error {
  constructor(readonly code: EvidencePrometheusRenderErrorCode) {
    super(`EVIDENCE_PROMETHEUS_RENDER_${code}`);
    this.name = 'EvidencePrometheusRenderError';
  }
}

const PAYMENT_FAILURE_RATIO_EXPRESSION =
  'rate(payment_charge_fail_count_total{service="payment-service"}[5m])'
  + ' / (rate(payment_charge_success_count_total{service="payment-service"}[5m])'
  + ' + rate(payment_charge_fail_count_total{service="payment-service"}[5m]))';

const PAYMENT_TIMEOUT_RATE_EXPRESSION =
  'rate(payment_charge_timeout_count_total{service="payment-service"}[5m])';

const NODE_FILESYSTEM_GROWTH_RATE_EXPRESSION =
  'deriv(node_filesystem_avail_bytes{service="node",mountpoint="/data",fstype="ext4"}[15m])';
const HTTP_REQUEST_COUNT = 'http_server_requests_seconds_count';
const HTTP_REQUEST_BUCKET = 'http_server_requests_seconds_bucket';
const FIVE_MINUTE_RATE = '[5m]';

const COMPARISON_OPERATORS = new Set(['GT', 'GTE', 'LT', 'LTE', 'EQ']);
const RECIPE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SERVICE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

export function renderPrometheusEvidenceQuery(
  recipe: EvidenceRecipeDefinition,
): RenderedPrometheusEvidenceQuery {
  if (recipe.source !== 'PROMETHEUS') {
    throw new EvidencePrometheusRenderError('UNSUPPORTED_SOURCE');
  }
  if (recipe.observationMode !== 'WINDOWED' || recipe.projection !== 'NUMERIC') {
    throw new EvidencePrometheusRenderError('INVALID_RECIPE');
  }
  if (!RECIPE_ID_PATTERN.test(recipe.id)
    || !EVIDENCE_WINDOW_VALUES.includes(recipe.window)
    || recipe.predicate.kind !== 'COMPARISON'
    || !COMPARISON_OPERATORS.has(recipe.predicate.operator)
    || !Number.isFinite(recipe.predicate.value)) {
    throw new EvidencePrometheusRenderError('INVALID_RECIPE');
  }

  const renderedTemplate = renderFixedTemplate(recipe);
  return {
    source: 'PROMETHEUS',
    ...renderedTemplate,
    window: recipe.window,
    predicate: {
      kind: 'COMPARISON',
      operator: recipe.predicate.operator,
      value: recipe.predicate.value,
    },
    projection: 'NUMERIC',
  };
}

function renderFixedTemplate(
  recipe: EvidenceRecipeDefinition,
): Pick<RenderedPrometheusEvidenceQuery, 'template' | 'expression'> {
  switch (recipe.template) {
    case 'HTTP_P99':
      assertHttpScope(recipe);
      return {
        template: recipe.template,
        expression: `histogram_quantile(0.99, sum by (service, uri, le) `
          + `(rate(${metricSelector(HTTP_REQUEST_BUCKET, recipe)}${FIVE_MINUTE_RATE})))`,
      };
    case 'HTTP_ERROR_RATIO':
      assertHttpScope(recipe);
      return {
        template: recipe.template,
        expression: `sum by (service, uri) `
          + `(rate(${metricSelector(HTTP_REQUEST_COUNT, recipe, 'status=~"5.."')}${FIVE_MINUTE_RATE}))`
          + ` / sum by (service, uri) `
          + `(rate(${metricSelector(HTTP_REQUEST_COUNT, recipe)}${FIVE_MINUTE_RATE}))`,
      };
    case 'HTTP_RATE':
      assertHttpScope(recipe);
      return {
        template: recipe.template,
        expression: `sum by (service, uri) `
          + `(rate(${metricSelector(HTTP_REQUEST_COUNT, recipe)}${FIVE_MINUTE_RATE}))`,
      };
    case 'HIKARI_UTILIZATION':
      assertServiceOnlyScope(recipe);
      return {
        template: recipe.template,
        expression: `sum by (service) (hikaricp_connections_active${serviceMatcher(recipe)})`
          + ` / sum by (service) (hikaricp_connections_max${serviceMatcher(recipe)})`,
      };
    case 'JVM_HEAP_RATIO':
      assertServiceOnlyScope(recipe);
      return {
        template: recipe.template,
        expression: `sum by (service) `
          + `(jvm_memory_used_bytes${serviceAreaMatcher(recipe, 'heap')})`
          + ` / sum by (service) `
          + `(jvm_memory_max_bytes${serviceAreaMatcher(recipe, 'heap')})`,
      };
    case 'MYSQL_SLOW_QUERY_RATE':
      assertServiceOnlyScope(recipe, 'mysql');
      return {
        template: recipe.template,
        expression: `sum by (service) `
          + `(rate(mysql_global_status_slow_queries${serviceMatcher(recipe)}${FIVE_MINUTE_RATE}))`,
      };
    case 'PAYMENT_FAILURE_RATIO':
      assertPaymentScope(recipe);
      return { template: recipe.template, expression: PAYMENT_FAILURE_RATIO_EXPRESSION };
    case 'PAYMENT_TIMEOUT_RATE':
      assertPaymentScope(recipe);
      return { template: recipe.template, expression: PAYMENT_TIMEOUT_RATE_EXPRESSION };
    case 'REDIS_MEMORY_RATIO':
      assertServiceOnlyScope(recipe, 'redis');
      return {
        template: recipe.template,
        expression: `redis_memory_used_bytes${serviceMatcher(recipe)}`
          + ` / redis_memory_max_bytes${serviceMatcher(recipe)}`,
      };
    case 'NODE_FILESYSTEM_RATIO':
      assertFilesystemScope(recipe);
      return {
        template: recipe.template,
        expression: `1 - node_filesystem_avail_bytes${filesystemMatcher(recipe)}`
          + ` / node_filesystem_size_bytes${filesystemMatcher(recipe)}`,
      };
    case 'NODE_FILESYSTEM_GROWTH_RATE':
      assertFilesystemScope(recipe);
      return { template: recipe.template, expression: NODE_FILESYSTEM_GROWTH_RATE_EXPRESSION };
    default:
      throw new EvidencePrometheusRenderError('UNSUPPORTED_TEMPLATE');
  }
}

function assertPaymentScope(recipe: EvidenceRecipeDefinition): void {
  assertServiceOnlyScope(recipe, 'payment-service');
}

function assertServiceOnlyScope(recipe: EvidenceRecipeDefinition, expectedService?: string): void {
  if (!SERVICE_PATTERN.test(recipe.scope.service)
    || (expectedService !== undefined && recipe.scope.service !== expectedService)
    || recipe.scope.route !== undefined
    || recipe.scope.fixedLabels !== undefined
    || !hasOnlyScopeKeys(recipe, ['service'])) {
    throw new EvidencePrometheusRenderError('INVALID_SCOPE');
  }
}

function assertHttpScope(recipe: EvidenceRecipeDefinition): void {
  if (!SERVICE_PATTERN.test(recipe.scope.service)
    || recipe.scope.fixedLabels !== undefined
    || (recipe.scope.route !== undefined && !isSafeRoute(recipe.scope.route))
    || !hasOnlyScopeKeys(recipe, ['service', 'route'])) {
    throw new EvidencePrometheusRenderError('INVALID_SCOPE');
  }
}

function assertFilesystemScope(recipe: EvidenceRecipeDefinition): void {
  const fixedLabels = recipe.scope.fixedLabels;
  if (recipe.scope.service !== 'node'
    || recipe.scope.route !== undefined
    || fixedLabels === undefined
    || Object.keys(fixedLabels).sort().join(',') !== 'fstype,mountpoint'
    || fixedLabels.mountpoint !== '/data'
    || fixedLabels.fstype !== 'ext4'
    || !hasOnlyScopeKeys(recipe, ['service', 'fixedLabels'])) {
    throw new EvidencePrometheusRenderError('INVALID_SCOPE');
  }
}

function hasOnlyScopeKeys(
  recipe: EvidenceRecipeDefinition,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(recipe.scope).every((key) => allowed.has(key));
}

function serviceMatcher(recipe: EvidenceRecipeDefinition): string {
  return `{service=${quoteLabelValue(recipe.scope.service)}}`;
}

function serviceAreaMatcher(recipe: EvidenceRecipeDefinition, area: 'heap'): string {
  return `{service=${quoteLabelValue(recipe.scope.service)},area="${area}"}`;
}

function filesystemMatcher(recipe: EvidenceRecipeDefinition): string {
  const labels = recipe.scope.fixedLabels!;
  return `{service="node",mountpoint=${quoteLabelValue(labels.mountpoint)},fstype=${quoteLabelValue(labels.fstype)}}`;
}

function metricSelector(
  metric: string,
  recipe: EvidenceRecipeDefinition,
  extraMatchers?: string,
): string {
  const labels = [
    `service=${quoteLabelValue(recipe.scope.service)}`,
    ...(recipe.scope.route === undefined ? [] : [`uri=${quoteLabelValue(recipe.scope.route)}`]),
    ...(extraMatchers === undefined ? [] : [extraMatchers]),
  ];
  return `${metric}{${labels.join(',')}}`;
}

function quoteLabelValue(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function isSafeRoute(value: string): boolean {
  return value.startsWith('/')
    && value.length <= 256
    && !/[\u0000-\u0020\u007f?#]/u.test(value);
}
