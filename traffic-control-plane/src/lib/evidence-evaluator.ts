import type {
  EvidenceEffectAssessment,
  EvidenceCoverage,
  EvidenceItemAvailability,
  EvidencePredicateOutcome,
  EvidenceStatus,
  RenderedEvidenceRecipe,
} from './evidence-types';
import type { EvidencePredicate, EvidenceSource, EvidenceWindow } from './scenario-contract';
import type { EvidenceQueryClientResponse, MetricRangeResult } from './evidence-query-clients';
import { resolveEvidenceValueUnit } from './evidence-query-plan-renderer';

export type EvidenceEvaluationErrorCode =
  | 'EVIDENCE_EVALUATION_RECIPE_INVALID'
  | 'EVIDENCE_EVALUATION_RESULT_MISMATCH';

export class EvidenceEvaluationError extends Error {
  constructor(readonly code: EvidenceEvaluationErrorCode) {
    super(code);
    this.name = 'EvidenceEvaluationError';
  }
}

export interface EvidenceRecipeEvaluation {
  readonly recipeId: string;
  readonly source: EvidenceSource;
  readonly window: EvidenceWindow;
  readonly observationMode: 'WINDOWED' | 'CURRENT';
  readonly predicateOutcome: EvidencePredicateOutcome;
}

export interface EvidenceEffectRuleEvaluation {
  readonly assessment: EvidenceEffectAssessment;
  readonly recipeOutcomes: readonly {
    readonly recipeId: string;
    readonly predicateOutcome: EvidencePredicateOutcome;
  }[];
}

export interface EvidenceReportStatusFact {
  readonly source: EvidenceSource;
  readonly window: EvidenceWindow;
  readonly observationMode: 'WINDOWED' | 'CURRENT';
  readonly required: boolean;
  readonly availability: EvidenceItemAvailability;
  readonly coverage: EvidenceCoverage;
}

export interface EvaluateEvidenceRecipeInput {
  readonly recipe: RenderedEvidenceRecipe;
  readonly availability: EvidenceItemAvailability;
  readonly coverage: EvidenceCoverage;
  readonly result: EvidenceQueryClientResponse | null;
}

export function evaluateEvidenceRecipePredicate(
  input: EvaluateEvidenceRecipeInput,
): EvidencePredicateOutcome {
  const { recipe, availability, coverage, result } = input;
  if (recipe.predicate.kind === 'NONE'
    || recipe.source === 'RUN_EVENT'
    || recipe.source === 'BUSINESS_CHECK'
    || recipe.window === 'baseline') return 'INCONCLUSIVE';
  if (recipe.valueUnit !== resolveEvidenceValueUnit(recipe)) {
    throw new EvidenceEvaluationError('EVIDENCE_EVALUATION_RECIPE_INVALID');
  }
  if (coverage !== 'FULL' || (availability !== 'AVAILABLE' && availability !== 'NO_DATA')) {
    return 'INCONCLUSIVE';
  }
  if (!result || result.recipeId !== recipe.recipeId || result.source !== recipe.source) {
    throw new EvidenceEvaluationError('EVIDENCE_EVALUATION_RESULT_MISMATCH');
  }
  const values = resultValues(recipe, result);
  if (values === null || values.length === 0) return 'INCONCLUSIVE';
  const matches = values.map((value) => evaluatePredicate(recipe.predicate, value));
  if (recipe.aggregation === 'ACTIVE_ANY_SAMPLE'
    || recipe.aggregation === 'LOKI_BUCKET_SERIES' && recipe.window === 'active') {
    return matches.some(Boolean) ? 'MET' : 'NOT_MET';
  }
  if (recipe.aggregation === 'RECOVERY_ALL_SAMPLES'
    || recipe.aggregation === 'LOKI_BUCKET_SERIES') {
    return matches.every(Boolean) ? 'MET' : 'NOT_MET';
  }
  if (recipe.aggregation === 'TRACE_MATCH_COUNT') {
    return matches[0] ? 'MET' : 'NOT_MET';
  }
  return 'INCONCLUSIVE';
}

export function evaluateEvidenceEffectRule(
  mode: 'ALL' | 'ANY',
  recipeIds: readonly string[],
  evaluations: readonly EvidenceRecipeEvaluation[],
): EvidenceEffectRuleEvaluation {
  if ((mode !== 'ALL' && mode !== 'ANY') || recipeIds.length === 0
    || new Set(recipeIds).size !== recipeIds.length) {
    throw new EvidenceEvaluationError('EVIDENCE_EVALUATION_RECIPE_INVALID');
  }
  const evaluationById = new Map<string, EvidenceRecipeEvaluation>();
  for (const evaluation of evaluations) {
    if (evaluationById.has(evaluation.recipeId)) {
      throw new EvidenceEvaluationError('EVIDENCE_EVALUATION_RECIPE_INVALID');
    }
    evaluationById.set(evaluation.recipeId, evaluation);
  }
  const recipeOutcomes = recipeIds.map((recipeId) => {
    const evaluation = evaluationById.get(recipeId);
    if (evaluation && (
      evaluation.observationMode !== 'WINDOWED'
      || evaluation.window === 'baseline'
      || (evaluation.source !== 'PROMETHEUS'
        && evaluation.source !== 'LOKI'
        && evaluation.source !== 'TEMPO')
    )) {
      throw new EvidenceEvaluationError('EVIDENCE_EVALUATION_RECIPE_INVALID');
    }
    return {
      recipeId,
      predicateOutcome: evaluation?.predicateOutcome ?? 'INCONCLUSIVE',
    };
  });
  const outcomes = recipeOutcomes.map(({ predicateOutcome }) => predicateOutcome);
  const assessment: EvidenceEffectAssessment = mode === 'ALL'
    ? outcomes.includes('NOT_MET') ? 'NOT_OBSERVED'
      : outcomes.every((outcome) => outcome === 'MET') ? 'OBSERVED' : 'INCONCLUSIVE'
    : outcomes.includes('MET') ? 'OBSERVED'
      : outcomes.every((outcome) => outcome === 'NOT_MET') ? 'NOT_OBSERVED' : 'INCONCLUSIVE';
  return { assessment, recipeOutcomes };
}

export function aggregateEvidenceReportStatus(
  facts: readonly EvidenceReportStatusFact[],
): EvidenceStatus {
  if (facts.some(({ availability }) => availability === 'INVALID_QUERY')) return 'INVALID_QUERY';
  const telemetry = facts.filter(({ source, window, observationMode }) =>
    observationMode === 'WINDOWED'
      && window !== 'baseline'
      && (source === 'PROMETHEUS' || source === 'LOKI' || source === 'TEMPO'));
  if (telemetry.length === 0
    || telemetry.every(({ availability }) => availability === 'EVIDENCE_UNAVAILABLE')) {
    return 'EVIDENCE_UNAVAILABLE';
  }
  if (telemetry.some(({ required, availability }) =>
    required && availability === 'EVIDENCE_UNAVAILABLE')) {
    return 'EVIDENCE_UNAVAILABLE';
  }
  if (facts.some(({ availability, coverage }) =>
    availability === 'EVIDENCE_UNAVAILABLE'
      || availability === 'NO_DATA' && coverage !== 'FULL'
      || coverage === 'PARTIAL'
      || coverage === 'NONE')) {
    return 'PARTIAL';
  }
  return 'AVAILABLE';
}

function resultValues(
  recipe: RenderedEvidenceRecipe,
  result: EvidenceQueryClientResponse,
): number[] | null {
  if (recipe.source === 'PROMETHEUS' || recipe.source === 'LOKI') {
    if (result.source !== recipe.source || !isMetricRecipeValueUnit(recipe)) {
      throw new EvidenceEvaluationError('EVIDENCE_EVALUATION_RESULT_MISMATCH');
    }
    return flattenFiniteSamples(result);
  }
  if (recipe.source === 'TEMPO' && result.source === 'TEMPO') {
    if (result.truncated || result.reasonCode !== null) return null;
    if (recipe.valueUnit !== 'count') {
      throw new EvidenceEvaluationError('EVIDENCE_EVALUATION_RECIPE_INVALID');
    }
    return [result.traceCount];
  }
  throw new EvidenceEvaluationError('EVIDENCE_EVALUATION_RESULT_MISMATCH');
}

function flattenFiniteSamples(result: MetricRangeResult): number[] {
  const values: number[] = [];
  for (const series of result.series) {
    for (const sample of series) {
      if (sample.value === null || sample.reasonCode !== null || !Number.isFinite(sample.value)) {
        return [];
      }
      values.push(sample.value);
    }
  }
  return values;
}

function evaluatePredicate(predicate: EvidencePredicate, value: number): boolean {
  if (predicate.kind !== 'COMPARISON' || !Number.isFinite(value)) return false;
  switch (predicate.operator) {
    case 'GT': return value > predicate.value;
    case 'GTE': return value >= predicate.value;
    case 'LT': return value < predicate.value;
    case 'LTE': return value <= predicate.value;
    case 'EQ': return value === predicate.value;
  }
}

function isMetricRecipeValueUnit(recipe: RenderedEvidenceRecipe): boolean {
  return recipe.source === 'PROMETHEUS'
    ? recipe.projection === 'NUMERIC'
    : recipe.source === 'LOKI'
      && recipe.projection === 'COUNT'
      && recipe.valueUnit === 'count';
}
