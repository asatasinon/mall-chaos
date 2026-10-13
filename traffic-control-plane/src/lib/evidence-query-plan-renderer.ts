import type {
  EvidenceContractPlan,
  EvidencePredicate,
  EvidenceRecipeDefinition,
} from './scenario-contract';
import {
  isEvidenceContractPlan,
} from './scenario-contract';
import { renderPrometheusEvidenceQuery } from './evidence-query-prometheus-renderer';
import {
  EVIDENCE_EVALUATION_REVISION,
  EVIDENCE_RENDERED_PLAN_SCHEMA_VERSION,
  EVIDENCE_RENDERER_REVISION,
  isEvidenceRenderedPlan,
  type EvidenceRenderedPlan,
  type EvidenceValueUnit,
  type EvidenceWindowLimits,
  type RenderedEvidenceRecipe,
} from './evidence-types';

const SERVICE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
export { EVIDENCE_EVALUATION_REVISION, EVIDENCE_RENDERER_REVISION };

export type EvidencePlanRenderErrorCode =
  | 'INVALID_CONTRACT'
  | 'INVALID_WINDOW_LIMITS'
  | 'UNSUPPORTED_SOURCE'
  | 'UNSUPPORTED_TEMPLATE'
  | 'INVALID_RECIPE';

export class EvidencePlanRenderError extends Error {
  constructor(readonly code: EvidencePlanRenderErrorCode) {
    super(`EVIDENCE_PLAN_RENDER_${code}`);
    this.name = 'EvidencePlanRenderError';
  }
}

export function renderEvidenceQueryPlan(
  contract: EvidenceContractPlan,
  windowLimits: EvidenceWindowLimits,
): EvidenceRenderedPlan {
  if (!isEvidenceContractPlan(contract)) throw new EvidencePlanRenderError('INVALID_CONTRACT');
  if (!isValidWindowLimits(windowLimits)) throw new EvidencePlanRenderError('INVALID_WINDOW_LIMITS');
  if (contract.effectRule.recipeIds.some((recipeId) =>
    contract.recipes.some((recipe) => recipe.id === recipeId && recipe.source === 'LOKI'))) {
    throw new EvidencePlanRenderError('INVALID_CONTRACT');
  }

  const renderedRecipes = contract.recipes.map(renderRecipe);
  const baselineRecipes = renderedRecipes
    .filter((recipe) => recipe.window === 'active'
      && recipe.observationMode === 'WINDOWED'
      && (recipe.source === 'PROMETHEUS' || recipe.source === 'LOKI' || recipe.source === 'TEMPO'))
    .map((recipe) => ({
      ...recipe,
      window: 'baseline' as const,
      required: false,
      predicate: { kind: 'NONE' as const },
      aggregation: 'BASELINE_SUMMARY' as const,
      baselineForRecipeId: recipe.recipeId,
    }));
  const plan: EvidenceRenderedPlan = {
    schemaVersion: EVIDENCE_RENDERED_PLAN_SCHEMA_VERSION,
    rendererRevision: EVIDENCE_RENDERER_REVISION,
    evaluationRevision: EVIDENCE_EVALUATION_REVISION,
    windowLimits: structuredClone(windowLimits),
    recipes: [...renderedRecipes, ...baselineRecipes],
  };
  if (!isEvidenceRenderedPlan(plan)) throw new EvidencePlanRenderError('INVALID_RECIPE');
  return plan;
}

export function renderTempoEvidenceQuery(recipe: EvidenceRecipeDefinition): string {
  if (recipe.source !== 'TEMPO'
    || recipe.observationMode !== 'WINDOWED'
    || !SERVICE_PATTERN.test(recipe.scope.service)
    || (recipe.scope.route !== undefined && !isSafeRoute(recipe.scope.route))) {
    throw new EvidencePlanRenderError('INVALID_RECIPE');
  }
  const filters = [`resource.service.name = ${quoteTraceQL(recipe.scope.service)}`];
  if (recipe.scope.route !== undefined) {
    filters.push(`span.http.route = ${quoteTraceQL(recipe.scope.route)}`);
  }

  switch (recipe.template) {
    case 'SERVICE_REQUESTS':
      break;
    case 'SERVICE_ERRORS':
      filters.push('status = error');
      break;
    case 'SERVICE_SLOW_REQUESTS':
      if (recipe.predicate.kind !== 'COMPARISON' || recipe.predicate.value < 0) {
        throw new EvidencePlanRenderError('INVALID_RECIPE');
      }
      filters.push(
        `duration ${traceQLComparisonOperator(recipe.predicate.operator)} ${formatTempoDuration(recipe.predicate.value)}`,
      );
      break;
    case 'SERVICE_ROUTE_REQUESTS':
      if (recipe.scope.route === undefined) throw new EvidencePlanRenderError('INVALID_RECIPE');
      break;
    default:
      throw new EvidencePlanRenderError('UNSUPPORTED_TEMPLATE');
  }
  return `{ ${filters.join(' && ')} }`;
}

function renderRecipe(recipe: EvidenceRecipeDefinition): RenderedEvidenceRecipe {
  const renderedQuery = (() => {
    switch (recipe.source) {
      case 'PROMETHEUS':
        return renderPrometheusEvidenceQuery(recipe).expression;
      case 'LOKI':
        return renderLokiEvidenceQuery(recipe);
      case 'TEMPO':
        return renderTempoEvidenceQuery(recipe);
      case 'BUSINESS_CHECK':
      case 'RUN_EVENT':
        return null;
      default:
        throw new EvidencePlanRenderError('UNSUPPORTED_SOURCE');
    }
  })();
  const businessCheckId = recipe.source === 'BUSINESS_CHECK'
    && (recipe.template === 'CATALOG_PRODUCT_LIST' || recipe.template === 'CATALOG_BROWSE_REPORT')
    ? recipe.template
    : null;
  const scopeMode = (recipe.source === 'LOKI'
    || (recipe.source === 'TEMPO' && recipe.scope.fixedLabels !== undefined))
    ? 'SERVICE_ONLY'
    : 'DECLARED';

  return {
    recipeId: recipe.id,
    source: recipe.source,
    window: recipe.window,
    observationMode: recipe.observationMode,
    required: recipe.required,
    template: recipe.template,
    scope: recipe.scope,
    scopeMode,
    predicate: resolveRenderedPredicate(recipe),
    projection: recipe.projection,
    renderedQuery,
    businessCheckId,
    valueUnit: resolveEvidenceValueUnit(recipe),
    lookbackSec: resolveLookbackSeconds(recipe),
    aggregation: resolveAggregation(recipe),
    baselineForRecipeId: null,
  };
}

function renderLokiEvidenceQuery(recipe: EvidenceRecipeDefinition): string {
  if (recipe.observationMode !== 'WINDOWED'
    || (recipe.template !== 'SERVICE_EVENT_COUNT' && recipe.template !== 'SERVICE_ERROR_COUNT')
    || !/^[a-z][a-z0-9-]{0,63}$/u.test(recipe.scope.service)) {
    throw new EvidencePlanRenderError('INVALID_RECIPE');
  }
  const selectors = [`service=${quoteLogQL(recipe.scope.service)}`];
  if (recipe.template === 'SERVICE_ERROR_COUNT') selectors.push('log_level=~"ERROR|FATAL"');
  return `sum(count_over_time({${selectors.join(',')}}[1m]))`;
}

export function resolveEvidenceValueUnit(
  recipe: Pick<EvidenceRecipeDefinition, 'source' | 'template'>,
): EvidenceValueUnit {
  if (recipe.source === 'RUN_EVENT' || recipe.template === 'RUN_TIMELINE') return 'timeline';
  if (recipe.source === 'BUSINESS_CHECK') return 'boolean';
  if (recipe.source === 'LOKI' || recipe.source === 'TEMPO') return 'count';
  switch (recipe.template) {
    case 'HTTP_P99':
      return 'seconds';
    case 'HTTP_ERROR_RATIO':
    case 'HIKARI_UTILIZATION':
    case 'JVM_HEAP_RATIO':
    case 'PAYMENT_FAILURE_RATIO':
    case 'REDIS_MEMORY_RATIO':
    case 'NODE_FILESYSTEM_RATIO':
      return 'ratio';
    case 'HTTP_RATE':
    case 'MYSQL_SLOW_QUERY_RATE':
    case 'PAYMENT_TIMEOUT_RATE':
      return 'count_per_second';
    case 'NODE_FILESYSTEM_GROWTH_RATE':
      return 'bytes_per_second';
    default:
      throw new EvidencePlanRenderError('UNSUPPORTED_TEMPLATE');
  }
}

function resolveRenderedPredicate(recipe: EvidenceRecipeDefinition): EvidencePredicate {
  if (recipe.source === 'TEMPO' && recipe.template === 'SERVICE_SLOW_REQUESTS') {
    return { kind: 'COMPARISON', operator: 'GT', value: 0 };
  }
  return recipe.predicate;
}

function resolveLookbackSeconds(recipe: EvidenceRecipeDefinition): number {
  if (recipe.source === 'PROMETHEUS') {
    if (recipe.template === 'NODE_FILESYSTEM_GROWTH_RATE') return 900;
    if ([
      'HTTP_P99',
      'HTTP_ERROR_RATIO',
      'HTTP_RATE',
      'MYSQL_SLOW_QUERY_RATE',
      'PAYMENT_FAILURE_RATIO',
      'PAYMENT_TIMEOUT_RATE',
    ].includes(recipe.template)) return 300;
    return 0;
  }
  return recipe.source === 'LOKI' ? 60 : 0;
}

function resolveAggregation(recipe: EvidenceRecipeDefinition): RenderedEvidenceRecipe['aggregation'] {
  if (recipe.source === 'RUN_EVENT') return 'TIMELINE';
  if (recipe.source === 'BUSINESS_CHECK') return 'CURRENT_BOOLEAN';
  if (recipe.source === 'PROMETHEUS') {
    if (recipe.window === 'baseline') return 'BASELINE_SUMMARY';
    if (recipe.window === 'active') return 'ACTIVE_ANY_SAMPLE';
    return 'RECOVERY_ALL_SAMPLES';
  }
  if (recipe.source === 'LOKI') {
    return recipe.window === 'baseline' ? 'BASELINE_SUMMARY' : 'LOKI_BUCKET_SERIES';
  }
  if (recipe.source === 'TEMPO') {
    return recipe.window === 'baseline' ? 'BASELINE_SUMMARY' : 'TRACE_MATCH_COUNT';
  }
  throw new EvidencePlanRenderError('UNSUPPORTED_SOURCE');
}

function quoteLogQL(value: string): string {
  return JSON.stringify(value);
}

function quoteTraceQL(value: string): string {
  return JSON.stringify(value);
}

function isSafeRoute(value: string): boolean {
  return value.startsWith('/')
    && value.length <= 256
    && !/[\u0000-\u0020\u007f?#]/u.test(value);
}

function traceQLComparisonOperator(
  operator: Extract<EvidencePredicate, { kind: 'COMPARISON' }>['operator'],
): string {
  switch (operator) {
    case 'GT': return '>';
    case 'GTE': return '>=';
    case 'LT': return '<';
    case 'LTE': return '<=';
    case 'EQ': return '=';
  }
}

function formatTempoDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new EvidencePlanRenderError('INVALID_RECIPE');
  }
  const milliseconds = seconds * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds < 1000
    ? `${milliseconds}ms`
    : `${seconds}s`;
}

function isValidWindowLimits(value: EvidenceWindowLimits): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'active,baseline,cleanup,recovery') return false;
  return ['baseline', 'active', 'recovery', 'cleanup'].every((window) => (
    Number.isSafeInteger(value[window as keyof EvidenceWindowLimits])
      && value[window as keyof EvidenceWindowLimits] >= 1
      && value[window as keyof EvidenceWindowLimits] <= 86_400
  ));
}
