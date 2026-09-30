import type {
  EvidencePredicate,
  EvidenceRecipeDefinition,
  EvidenceTemplateId,
} from './scenario-contract';

export type FixedPrometheusEvidenceTemplate = Extract<
  EvidenceTemplateId,
  'PAYMENT_FAILURE_RATIO' | 'PAYMENT_TIMEOUT_RATE' | 'NODE_FILESYSTEM_GROWTH_RATE'
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

const COMPARISON_OPERATORS = new Set(['GT', 'GTE', 'LT', 'LTE', 'EQ']);
const RECIPE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

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
    case 'PAYMENT_FAILURE_RATIO':
      assertPaymentScope(recipe);
      return { template: recipe.template, expression: PAYMENT_FAILURE_RATIO_EXPRESSION };
    case 'PAYMENT_TIMEOUT_RATE':
      assertPaymentScope(recipe);
      return { template: recipe.template, expression: PAYMENT_TIMEOUT_RATE_EXPRESSION };
    case 'NODE_FILESYSTEM_GROWTH_RATE':
      assertFilesystemScope(recipe);
      return { template: recipe.template, expression: NODE_FILESYSTEM_GROWTH_RATE_EXPRESSION };
    default:
      throw new EvidencePrometheusRenderError('UNSUPPORTED_TEMPLATE');
  }
}

function assertPaymentScope(recipe: EvidenceRecipeDefinition): void {
  if (recipe.scope.service !== 'payment-service'
    || recipe.scope.route !== undefined
    || recipe.scope.fixedLabels !== undefined
    || !hasOnlyScopeKeys(recipe, ['service'])) {
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
