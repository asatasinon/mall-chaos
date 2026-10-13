import type {
  EvidenceCoverage,
  EvidenceItemAvailability,
  RenderedEvidenceRecipe,
} from './evidence-types';
import { EvidenceTypeError, parseEvidenceSqlTimestamp } from './evidence-types';
import {
  EvidenceQueryClientError,
  type EvidenceQueryClientResponse,
  type MetricRangeResult,
  type NumericSample,
  type TempoSearchResult,
} from './evidence-query-clients';
import type { EvidenceQueryPreflight } from './evidence-query-preflight';

export type EvidenceCoverageReasonCode =
  | 'NO_MATCHING_SERIES'
  | 'NO_SAMPLES'
  | 'NON_FINITE_SAMPLE'
  | 'SAMPLE_GAP'
  | 'PROVIDER_WARNING'
  | 'QUERY_RESULT_TRUNCATED'
  | 'SEARCH_INCOMPLETE';

export interface EvidenceCoverageAssessment {
  readonly availability: EvidenceItemAvailability;
  readonly coverage: EvidenceCoverage;
  readonly reasonCodes: readonly EvidenceCoverageReasonCode[];
}

export interface CombinedEvidenceCoverageAssessment {
  readonly availability: EvidenceItemAvailability | null;
  readonly coverage: EvidenceCoverage;
  readonly predicateOutcome: 'INCONCLUSIVE' | null;
  readonly reasonCodes: readonly string[];
}

export interface EvidenceMetricSummary {
  readonly pointCount: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly latest: number;
}

export interface EvidenceBaselineComparison {
  readonly status: 'AVAILABLE' | 'BASELINE_UNAVAILABLE' | 'BASELINE_INCOMPATIBLE' | 'COUNT_CONTEXT_ONLY';
  readonly reasonCode: string | null;
  readonly active: EvidenceMetricSummary | null;
  readonly baseline: EvidenceMetricSummary | null;
  readonly delta: EvidenceMetricSummary | null;
  readonly percentDelta: EvidenceMetricPercentSummary | null;
}

export interface EvidenceMetricPercentSummary {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly latest: number | null;
}

export function assessEvidenceQueryCoverage(
  result: EvidenceQueryClientResponse,
): EvidenceCoverageAssessment {
  if (result.source === 'TEMPO') return assessTempoCoverage(result);
  return assessMetricCoverage(result);
}

export function combineEvidenceQueryCoverage(
  preflight: EvidenceQueryPreflight,
  sourceResult: EvidenceCoverageAssessment | null,
): CombinedEvidenceCoverageAssessment {
  if (!preflight.shouldQuery) {
    return {
      availability: preflight.availabilityHint,
      coverage: preflight.coverageHint ?? 'NONE',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCodes: [...preflight.reasonCodes],
    };
  }
  if (!sourceResult) throw new Error('EVIDENCE_QUERY_PREFLIGHT_RESULT_MISSING');
  const coverage = preflight.coverageHint === 'PARTIAL'
    ? 'PARTIAL'
    : sourceResult.coverage;
  return {
    availability: sourceResult.availability,
    coverage,
    predicateOutcome: coverage === 'FULL' ? null : 'INCONCLUSIVE',
    reasonCodes: [...new Set([...preflight.reasonCodes, ...sourceResult.reasonCodes])].sort(),
  };
}

export function compareEvidenceBaseline(
  activeRecipe: RenderedEvidenceRecipe,
  baselineRecipe: RenderedEvidenceRecipe,
  activeResult: EvidenceQueryClientResponse | null,
  baselineResult: EvidenceQueryClientResponse | null,
  activeCoverage: EvidenceCoverageAssessment,
  baselineCoverage: EvidenceCoverageAssessment,
): EvidenceBaselineComparison {
  const active = activeResult ? summarizeEvidenceResult(activeResult) : null;
  const baseline = baselineResult ? summarizeEvidenceResult(baselineResult) : null;
  const completeCoverage = (availability: EvidenceItemAvailability, coverage: EvidenceCoverage) =>
    coverage === 'FULL' && (availability === 'AVAILABLE' || availability === 'NO_DATA');
  if (!activeResult || !baselineResult
    || !completeCoverage(activeCoverage.availability, activeCoverage.coverage)
    || !completeCoverage(baselineCoverage.availability, baselineCoverage.coverage)) {
    return {
      status: 'BASELINE_UNAVAILABLE',
      reasonCode: 'BASELINE_UNAVAILABLE',
      active,
      baseline,
      delta: null,
      percentDelta: null,
    };
  }
  if (activeResult.recipeId !== activeRecipe.recipeId
    || baselineResult.recipeId !== baselineRecipe.recipeId
    || !areCompatibleBaselineRecipes(activeRecipe, baselineRecipe)
    || baselineResult.source !== activeResult.source) {
    return {
      status: 'BASELINE_INCOMPATIBLE',
      reasonCode: 'BASELINE_INCOMPATIBLE',
      active,
      baseline,
      delta: null,
      percentDelta: null,
    };
  }

  if (activeRecipe.projection === 'COUNT') {
    if (active === null || baseline === null) {
      return {
        status: 'BASELINE_UNAVAILABLE',
        reasonCode: 'BASELINE_UNAVAILABLE',
        active,
        baseline,
        delta: null,
        percentDelta: null,
      };
    }
    return {
      status: 'COUNT_CONTEXT_ONLY',
      reasonCode: 'COUNT_WINDOWS_DIFFER',
      active,
      baseline,
      delta: null,
      percentDelta: null,
    };
  }
  if (activeRecipe.projection !== 'NUMERIC'
    || activeResult.source === 'TEMPO' || baselineResult.source === 'TEMPO') {
    return {
      status: 'BASELINE_INCOMPATIBLE',
      reasonCode: 'BASELINE_INCOMPATIBLE',
      active,
      baseline,
      delta: null,
      percentDelta: null,
    };
  }
  if (activeCoverage.availability !== 'AVAILABLE' || baselineCoverage.availability !== 'AVAILABLE') {
    return {
      status: 'BASELINE_UNAVAILABLE',
      reasonCode: 'BASELINE_UNAVAILABLE',
      active,
      baseline,
      delta: null,
      percentDelta: null,
    };
  }

  const activeNumeric = summarizeMetricResult(activeResult);
  const baselineNumeric = summarizeMetricResult(baselineResult);
  if (activeNumeric === null || baselineNumeric === null) {
    return {
      status: 'BASELINE_UNAVAILABLE',
      reasonCode: 'BASELINE_UNAVAILABLE',
      active,
      baseline,
      delta: null,
      percentDelta: null,
    };
  }
  const delta = subtractSummaries(activeNumeric, baselineNumeric);
  if (![delta.minimum, delta.maximum, delta.latest].every(Number.isFinite)) {
    return {
      status: 'BASELINE_INCOMPATIBLE',
      reasonCode: 'BASELINE_COMPARISON_NON_FINITE',
      active: activeNumeric,
      baseline: baselineNumeric,
      delta: null,
      percentDelta: null,
    };
  }
  const percentDelta: EvidenceMetricPercentSummary = {
    minimum: baselineNumeric.minimum === 0 ? null : delta.minimum / baselineNumeric.minimum * 100,
    maximum: baselineNumeric.maximum === 0 ? null : delta.maximum / baselineNumeric.maximum * 100,
    latest: baselineNumeric.latest === 0 ? null : delta.latest / baselineNumeric.latest * 100,
  };
  const zeroBaseline = baselineNumeric.minimum === 0
    || baselineNumeric.maximum === 0
    || baselineNumeric.latest === 0;
  const nonFinitePercentage = Object.values(percentDelta).some((value) =>
    value !== null && !Number.isFinite(value));
  const safePercentDelta = {
    minimum: safePercentage(percentDelta.minimum),
    maximum: safePercentage(percentDelta.maximum),
    latest: safePercentage(percentDelta.latest),
  };
  return {
    status: 'AVAILABLE',
    reasonCode: zeroBaseline
      ? 'ZERO_BASELINE_PERCENTAGE_OMITTED'
      : nonFinitePercentage ? 'NON_FINITE_BASELINE_PERCENTAGE_OMITTED' : null,
    active: activeNumeric,
    baseline: baselineNumeric,
    delta,
    percentDelta: safePercentDelta,
  };
}

function assessTempoCoverage(result: TempoSearchResult): EvidenceCoverageAssessment {
  if (result.truncated || result.reasonCode === 'SEARCH_INCOMPLETE') {
    return {
      availability: result.traceCount === 0 ? 'NO_DATA' : 'AVAILABLE',
      coverage: 'PARTIAL',
      reasonCodes: ['SEARCH_INCOMPLETE'],
    };
  }
  return {
    availability: result.traceCount === 0 ? 'NO_DATA' : 'AVAILABLE',
    coverage: 'FULL',
    reasonCodes: [],
  };
}

function areCompatibleBaselineRecipes(
  active: RenderedEvidenceRecipe,
  baseline: RenderedEvidenceRecipe,
): boolean {
  return active.recipeId === baseline.recipeId
    && active.baselineForRecipeId === null
    && baseline.baselineForRecipeId === active.recipeId
    && active.window === 'active'
    && baseline.window === 'baseline'
    && active.source === baseline.source
    && active.template === baseline.template
    && active.observationMode === 'WINDOWED'
    && baseline.observationMode === 'WINDOWED'
    && active.projection === baseline.projection
    && active.valueUnit === baseline.valueUnit
    && active.scopeMode === baseline.scopeMode
    && active.lookbackSec === baseline.lookbackSec
    && active.renderedQuery === baseline.renderedQuery
    && JSON.stringify(active.scope) === JSON.stringify(baseline.scope);
}

export function summarizeEvidenceResult(result: EvidenceQueryClientResponse): EvidenceMetricSummary | null {
  if (result.source === 'TEMPO') {
    return {
      pointCount: result.traceCount,
      minimum: result.traceCount,
      maximum: result.traceCount,
      latest: result.traceCount,
    };
  }
  return summarizeMetricResult(result);
}

function summarizeMetricResult(result: MetricRangeResult): EvidenceMetricSummary | null {
  let pointCount = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  let latest: number | null = null;
  for (const series of result.series) {
    for (const sample of series) {
      const value = sample.value;
      if (value === null || !Number.isFinite(value)) continue;
      pointCount += 1;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      if (sample.timestampMs > latestTimestamp) {
        latestTimestamp = sample.timestampMs;
        latest = value;
      } else if (sample.timestampMs === latestTimestamp) {
        latest = latest === null ? value : Math.max(latest, value);
      }
    }
  }
  if (pointCount === 0 || latest === null) return null;
  return {
    pointCount,
    minimum,
    maximum,
    latest,
  };
}

function subtractSummaries(
  active: EvidenceMetricSummary,
  baseline: EvidenceMetricSummary,
): EvidenceMetricSummary {
  return {
    pointCount: Math.min(active.pointCount, baseline.pointCount),
    minimum: active.minimum - baseline.minimum,
    maximum: active.maximum - baseline.maximum,
    latest: active.latest - baseline.latest,
  };
}

function safePercentage(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function assessMetricCoverage(result: MetricRangeResult): EvidenceCoverageAssessment {
  const reasons = new Set<EvidenceCoverageReasonCode>();
  if (result.truncated) reasons.add('QUERY_RESULT_TRUNCATED');
  if (result.hasWarnings) reasons.add('PROVIDER_WARNING');
  if (result.series.length === 0) {
    return result.hasWarnings || result.truncated
      ? {
        availability: 'NO_DATA',
        coverage: 'PARTIAL',
        reasonCodes: [...reasons],
      }
      : {
        availability: 'NO_DATA',
        coverage: 'NONE',
        reasonCodes: ['NO_MATCHING_SERIES'],
      };
  }
  const hasAnySamples = result.series.some((series) => series.length > 0);
  if (!hasAnySamples && !result.hasWarnings && !result.truncated) {
    return { availability: 'NO_DATA', coverage: 'NONE', reasonCodes: ['NO_SAMPLES'] };
  }

  const startMs = parseTimestamp(result.startAt);
  const endMs = parseTimestamp(result.endAt);
  if (!Number.isSafeInteger(result.stepSec) || result.stepSec < 1 || endMs <= startMs) {
    throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
  }
  const expectedPoints = Math.floor((endMs - startMs) / (result.stepSec * 1000)) + 1;
  let validSamples = 0;
  let totalSamples = 0;
  for (const series of result.series) {
    totalSamples += series.length;
    if (series.length < expectedPoints) reasons.add('SAMPLE_GAP');
    if (seriesHasGap(series, result.stepSec, startMs, endMs)) reasons.add('SAMPLE_GAP');
    for (const sample of series) {
      if (sample.value === null || sample.reasonCode !== null || !Number.isFinite(sample.value)) {
        reasons.add('NON_FINITE_SAMPLE');
      } else {
        validSamples += 1;
      }
    }
  }
  if (totalSamples === 0 && reasons.size === 0) {
    return { availability: 'NO_DATA', coverage: 'NONE', reasonCodes: ['NO_SAMPLES'] };
  }
  const reasonCodes = [...reasons].sort();
  return {
    availability: validSamples === 0 ? 'NO_DATA' : 'AVAILABLE',
    coverage: reasonCodes.length > 0 ? 'PARTIAL' : 'FULL',
    reasonCodes,
  };
}

function seriesHasGap(
  series: readonly NumericSample[],
  stepSec: number,
  startMs: number,
  endMs: number,
): boolean {
  let hasGap = series.length === 0;
  if (series.length > 0) {
    if (series.some((sample) => !Number.isSafeInteger(sample.timestampMs)
      || sample.timestampMs < startMs || sample.timestampMs > endMs)) {
      throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
    }
    if (series[0]!.timestampMs - startMs > stepSec * 1000 * 1.5
      || endMs - series[series.length - 1]!.timestampMs > stepSec * 1000 * 1.5) {
      hasGap = true;
    }
    if (series.some((sample) => sample.timestampMs < startMs || sample.timestampMs > endMs)) {
      throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
    }
  }
  for (let index = 1; index < series.length; index++) {
    const gapMs = series[index]!.timestampMs - series[index - 1]!.timestampMs;
    if (!Number.isSafeInteger(gapMs) || gapMs <= 0) {
      throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
    }
    if (gapMs > stepSec * 1000 * 1.5) hasGap = true;
  }
  return hasGap;
}

function parseTimestamp(value: string): number {
  try {
    return Date.parse(parseEvidenceSqlTimestamp(value));
  } catch (error) {
    if (error instanceof EvidenceTypeError) throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
    throw error;
  }
}
