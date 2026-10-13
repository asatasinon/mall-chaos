import type {
  EvidenceBusinessCheckResult,
} from './evidence-business-checks';
import { EVIDENCE_WINDOW_VALUES, type EvidenceWindow } from './scenario-contract';
import type {
  EvidenceCoverage,
  EvidenceResolvedWindow,
  EvidenceTimeline,
  RenderedEvidenceRecipe,
} from './evidence-types';

export type EvidenceObservationAdapterErrorCode =
  | 'EVIDENCE_OBSERVATION_INVALID_RECIPE'
  | 'EVIDENCE_OBSERVATION_EFFECT_RULE_VIOLATION'
  | 'EVIDENCE_OBSERVATION_WINDOW_MISMATCH';

export class EvidenceObservationAdapterError extends Error {
  constructor(readonly code: EvidenceObservationAdapterErrorCode) {
    super(code);
    this.name = 'EvidenceObservationAdapterError';
  }
}

export interface RunTimelineObservation {
  readonly source: 'RUN_EVENT';
  readonly recipeId: string;
  readonly window: EvidenceWindow;
  readonly observationMode: 'WINDOWED';
  readonly windowState: EvidenceResolvedWindow['state'];
  readonly availability: 'AVAILABLE' | 'NOT_APPLICABLE';
  readonly coverage: EvidenceCoverage;
  readonly predicateOutcome: 'INCONCLUSIVE';
  readonly reasonCode: string | null;
  readonly timeline: EvidenceTimeline;
  readonly effectRuleEligible: false;
}

export interface CurrentBusinessCheckObservation {
  readonly source: 'BUSINESS_CHECK';
  readonly recipeId: string;
  readonly businessCheckId: EvidenceBusinessCheckResult['businessCheckId'];
  readonly window: EvidenceWindow;
  readonly observationMode: 'CURRENT';
  readonly isHistorical: false;
  readonly status: EvidenceBusinessCheckResult['status'];
  readonly checkedAt: string;
  readonly reasonCode: string | null;
  readonly effectRuleEligible: false;
}

export function adaptRunTimelineObservation(
  recipe: RenderedEvidenceRecipe,
  window: EvidenceResolvedWindow,
  timeline: EvidenceTimeline,
  effectRuleRecipeIds: readonly string[],
): RunTimelineObservation {
  if (recipe.source !== 'RUN_EVENT' || recipe.template !== 'RUN_TIMELINE'
    || recipe.observationMode !== 'WINDOWED'
    || recipe.predicate.kind !== 'NONE'
    || recipe.scopeMode !== 'DECLARED'
    || recipe.aggregation !== 'TIMELINE'
    || recipe.projection !== 'TIMELINE'
    || !EVIDENCE_WINDOW_VALUES.includes(recipe.window)
    || !effectRuleRecipeIds.every((recipeId) => typeof recipeId === 'string')) {
    throw new EvidenceObservationAdapterError('EVIDENCE_OBSERVATION_INVALID_RECIPE');
  }
  if (effectRuleRecipeIds.includes(recipe.recipeId)) {
    throw new EvidenceObservationAdapterError('EVIDENCE_OBSERVATION_EFFECT_RULE_VIOLATION');
  }
  if (window.name !== recipe.window) {
    throw new EvidenceObservationAdapterError('EVIDENCE_OBSERVATION_WINDOW_MISMATCH');
  }
  return {
    source: 'RUN_EVENT',
    recipeId: recipe.recipeId,
    window: recipe.window,
    observationMode: 'WINDOWED',
    windowState: window.state,
    availability: window.state === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'AVAILABLE',
    coverage: window.state === 'READY' ? 'FULL'
      : window.state === 'NOT_READY' ? 'NONE' : 'NOT_APPLICABLE',
    predicateOutcome: 'INCONCLUSIVE',
    reasonCode: window.reasonCode,
    timeline,
    effectRuleEligible: false,
  };
}

export function adaptCurrentBusinessCheckObservation(
  recipe: RenderedEvidenceRecipe,
  result: EvidenceBusinessCheckResult,
  effectRuleRecipeIds: readonly string[],
): CurrentBusinessCheckObservation {
  if (recipe.source !== 'BUSINESS_CHECK'
    || recipe.observationMode !== 'CURRENT'
    || recipe.renderedQuery !== null
    || recipe.businessCheckId === null
    || recipe.template !== recipe.businessCheckId
    || recipe.predicate.kind !== 'NONE'
    || recipe.scopeMode !== 'DECLARED'
    || recipe.aggregation !== 'CURRENT_BOOLEAN'
    || recipe.projection !== 'BOOLEAN'
    || recipe.valueUnit !== 'boolean'
    || result.recipeId !== recipe.recipeId
    || result.businessCheckId !== recipe.businessCheckId
    || !EVIDENCE_WINDOW_VALUES.includes(recipe.window)) {
    throw new EvidenceObservationAdapterError('EVIDENCE_OBSERVATION_INVALID_RECIPE');
  }
  if (effectRuleRecipeIds.includes(recipe.recipeId)) {
    throw new EvidenceObservationAdapterError('EVIDENCE_OBSERVATION_EFFECT_RULE_VIOLATION');
  }
  return {
    source: 'BUSINESS_CHECK',
    recipeId: recipe.recipeId,
    businessCheckId: recipe.businessCheckId,
    window: recipe.window,
    observationMode: 'CURRENT',
    isHistorical: false,
    status: result.status,
    checkedAt: result.checkedAt,
    reasonCode: result.reasonCode,
    effectRuleEligible: false,
  };
}
