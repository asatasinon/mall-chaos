const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

export type EvidenceWindowName = 'baseline' | 'active' | 'recovery' | 'cleanup';
export type EvidenceSourceName =
  | 'RUN_EVENT'
  | 'PROMETHEUS'
  | 'LOKI'
  | 'TEMPO'
  | 'BUSINESS_CHECK'
  | 'RESOURCE_CHECK';
export type EvidenceAvailability =
  | 'AVAILABLE'
  | 'NO_DATA'
  | 'EVIDENCE_UNAVAILABLE'
  | 'INVALID_QUERY'
  | 'NOT_APPLICABLE';
export type EvidenceCoverage = 'FULL' | 'PARTIAL' | 'NONE' | 'NOT_APPLICABLE';
export type EvidencePredicateOutcome = 'MET' | 'NOT_MET' | 'INCONCLUSIVE';
export type EvidenceStatus = 'AVAILABLE' | 'PARTIAL' | 'EVIDENCE_UNAVAILABLE' | 'INVALID_QUERY';
export type EvidenceAttemptState = 'RUNNING' | 'COMPLETED' | 'EVIDENCE_UNAVAILABLE' | 'FAILED';

export interface EvidenceWindowView {
  readonly name: EvidenceWindowName;
  readonly state: 'READY' | 'NOT_READY' | 'NOT_APPLICABLE';
  readonly canonicalStartAt: string | null;
  readonly canonicalEndAt: string | null;
  readonly reasonCode: string | null;
}

export async function copyFrozenEvidenceQuery(
  query: string,
  writeText: (value: string) => Promise<void>,
): Promise<'COPIED' | 'COPY_FAILED'> {
  if (query.length === 0) return 'COPY_FAILED';
  try {
    await writeText(query);
    return 'COPIED';
  } catch {
    return 'COPY_FAILED';
  }
}

function areBaselineLinksValid(recipes: readonly EvidenceRecipeView[]): boolean {
  const identities = new Set(recipes.map((recipe) => recipeWindowKey(recipe.recipeId, recipe.window)));
  if (identities.size !== recipes.length) return false;
  return recipes.every((baseline) => {
    if (baseline.window !== 'baseline' || baseline.baselineForRecipeId === null) return true;
    const active = recipes.find((recipe) =>
      recipe.recipeId === baseline.baselineForRecipeId && recipe.window === 'active');
    return active !== undefined && areComparableBaselineRecipes(baseline, active);
  });
}

function areComparableBaselineRecipes(
  baseline: EvidenceRecipeView,
  active: EvidenceRecipeView,
): boolean {
  return baseline.window === 'baseline'
    && active.window === 'active'
    && baseline.observationMode === 'WINDOWED'
    && active.observationMode === 'WINDOWED'
    && ['PROMETHEUS', 'LOKI', 'TEMPO'].includes(baseline.source)
    && baseline.required === false
    && baseline.recipeId === active.recipeId
    && baseline.source === active.source
    && baseline.valueUnit === active.valueUnit
    && baseline.lookbackSec === active.lookbackSec;
}

export interface EvidenceRecipeView {
  readonly recipeId: string;
  readonly source: EvidenceSourceName;
  readonly window: EvidenceWindowName;
  readonly observationMode: 'WINDOWED' | 'CURRENT';
  readonly required: boolean;
  readonly valueUnit: string;
  readonly lookbackSec: number;
  readonly baselineForRecipeId: string | null;
  readonly businessCheckId: 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT' | null;
  readonly renderedQuery: string | null;
}

export interface EvidenceManifestView {
  readonly manifestId: string;
  readonly sourceFaultRunId: string;
  readonly manifestRevision: number;
  readonly manifestHash: string;
  readonly sourceRunRetained: boolean;
  readonly materializedAt: string;
  readonly windows: readonly EvidenceWindowView[];
  readonly recipes: readonly EvidenceRecipeView[];
  readonly limitations: readonly { readonly code: string; readonly window: EvidenceWindowName | null }[];
}

export interface EvidenceAttemptItemView {
  readonly recipeId: string;
  readonly source: EvidenceSourceName;
  readonly window: EvidenceWindowName;
  readonly availability: EvidenceAvailability;
  readonly coverage: EvidenceCoverage;
  readonly predicateOutcome: EvidencePredicateOutcome;
  readonly reasonCode: string | null;
  readonly durationMs: number | null;
  readonly queriedAt: string | null;
  readonly executedStartAt: string | null;
  readonly executedEndAt: string | null;
}

export interface EvidenceReportHistoryView {
  readonly attemptId: string;
  readonly manifestId: string;
  readonly manifestRevision: number;
  readonly manifestHash: string;
  readonly state: EvidenceAttemptState;
  readonly evidenceStatus: EvidenceStatus | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly totalDurationMs: number | null;
  readonly failureCode: string | null;
  readonly operatorAuditId: number | null;
  readonly items: readonly EvidenceAttemptItemView[];
}

export interface EvidenceNoteView {
  readonly noteId: string;
  readonly manifestId: string;
  readonly requestHash: string;
  readonly operatorAuditId: number;
  readonly text: string;
  readonly createdAt: string;
}

export interface EvidenceLiveReportView {
  readonly manifestId: string;
  readonly manifestRevision: number;
  readonly manifestHash: string;
  readonly evaluatedAt: string | null;
  readonly evidenceStatus: EvidenceStatus;
  readonly effectAssessment: 'OBSERVED' | 'NOT_OBSERVED' | 'INCONCLUSIVE';
  readonly recipeOutcomes: readonly {
    readonly recipeId: string;
    readonly predicateOutcome: EvidencePredicateOutcome;
  }[];
  readonly items: readonly EvidenceAttemptItemView[];
  readonly recipeSummaries: readonly EvidenceRecipeSummaryView[];
  readonly baselineComparisons: readonly EvidenceBaselineComparisonView[];
}

export interface EvidenceMetricSummaryView {
  readonly pointCount: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly latest: number;
}

export interface EvidenceRecipeSummaryView {
  readonly recipeId: string;
  readonly source: EvidenceSourceName;
  readonly window: EvidenceWindowName;
  readonly valueUnit: string;
  readonly summary: EvidenceMetricSummaryView | null;
}

export interface EvidenceBaselineComparisonView {
  readonly recipeId: string;
  readonly source: EvidenceSourceName;
  readonly valueUnit: string;
  readonly status: 'AVAILABLE' | 'BASELINE_UNAVAILABLE' | 'BASELINE_INCOMPATIBLE' | 'COUNT_CONTEXT_ONLY';
  readonly reasonCode: string | null;
  readonly active: EvidenceMetricSummaryView | null;
  readonly baseline: EvidenceMetricSummaryView | null;
  readonly delta: EvidenceMetricSummaryView | null;
  readonly percentDelta: {
    readonly minimum: number | null;
    readonly maximum: number | null;
    readonly latest: number | null;
  } | null;
}

export interface EvidencePanelMetadata {
  readonly latestManifest: EvidenceManifestView;
  readonly manifests: readonly EvidenceManifestView[];
  readonly reports: readonly EvidenceReportHistoryView[];
  readonly notes: readonly EvidenceNoteView[];
  readonly omittedReportCount: number;
  readonly omittedNoteCount: number;
}

export interface EvidenceRecipeComparison {
  readonly recipeId: string;
  readonly source: EvidenceSourceName;
  readonly valueUnit: string;
  readonly lookbackSec: number;
  readonly baseline: EvidenceAttemptItemView | null;
  readonly active: EvidenceAttemptItemView | null;
  readonly numeric: EvidenceBaselineComparisonView | null;
}

export interface EvidenceCurrentCheckView {
  readonly recipe: EvidenceRecipeView;
  readonly item: EvidenceAttemptItemView | null;
}

export interface EvidencePanelProjection {
  readonly telemetryStatus: EvidenceStatus | 'RUNNING' | 'NOT_QUERIED';
  readonly effectAssessment: 'OBSERVED' | 'NOT_OBSERVED' | 'INCONCLUSIVE' | 'NOT_ASSESSED';
  readonly report: EvidenceReportHistoryView | null;
  readonly comparisons: readonly EvidenceRecipeComparison[];
  readonly currentChecks: readonly EvidenceCurrentCheckView[];
  readonly executedRanges: readonly EvidenceAttemptItemView[];
}

export function parseEvidenceManifestView(value: unknown, sourceRunId: string): EvidenceManifestView | null {
  if (!isRecord(value)
    || !isUuid(value.manifestId)
    || value.sourceFaultRunId !== sourceRunId
    || !isUuid(value.sourceFaultRunId)
    || !isPositiveInteger(value.manifestRevision)
    || !isSha256(value.manifestHash)
    || typeof value.sourceRunRetained !== 'boolean'
    || !isTimestamp(value.materializedAt)
    || !Array.isArray(value.windows)
    || value.windows.length > 4
    || !Array.isArray(value.recipes)
    || value.recipes.length > 1024
    || !Array.isArray(value.limitations)
    || value.limitations.length > 256) {
    return null;
  }
  const windows = value.windows.map(parseWindow);
  const recipes = value.recipes.map(parseRecipe);
  const limitations = value.limitations.map(parseLimitation);
  if (windows.some((window) => window === null)
    || recipes.some((recipe) => recipe === null)
    || limitations.some((limitation) => limitation === null)) {
    return null;
  }
  if (!areBaselineLinksValid(recipes as EvidenceRecipeView[])) return null;
  return {
    manifestId: value.manifestId,
    sourceFaultRunId: value.sourceFaultRunId,
    manifestRevision: value.manifestRevision,
    manifestHash: value.manifestHash,
    sourceRunRetained: value.sourceRunRetained,
    materializedAt: value.materializedAt,
    windows: windows as EvidenceWindowView[],
    recipes: recipes as EvidenceRecipeView[],
    limitations: limitations as EvidencePanelMetadata['manifests'][number]['limitations'],
  };
}

export function parseEvidenceManifestList(value: unknown, sourceRunId: string): EvidenceManifestView[] | null {
  if (!isRecord(value) || !Array.isArray(value.manifests) || value.manifests.length > 100) return null;
  const manifests = value.manifests.map((manifest) => parseEvidenceManifestView(manifest, sourceRunId));
  return manifests.some((manifest) => manifest === null) ? null : manifests as EvidenceManifestView[];
}

export function parseEvidenceReportHistory(value: unknown): EvidenceReportHistoryView[] | null {
  if (!isRecord(value) || !Array.isArray(value.reports) || value.reports.length > 100) return null;
  const reports = value.reports.map(parseReport);
  return reports.some((report) => report === null) ? null : reports as EvidenceReportHistoryView[];
}

export function parseEvidenceNoteHistory(value: unknown, sourceRunId: string): EvidenceNoteView[] | null {
  if (!isRecord(value) || !Array.isArray(value.notes) || value.notes.length > 100) return null;
  const notes = value.notes.map((note) => parseNote(note, sourceRunId));
  return notes.some((note) => note === null) ? null : notes as EvidenceNoteView[];
}

export function parseEvidenceLiveReport(
  value: unknown,
  manifest: EvidenceManifestView,
): EvidenceLiveReportView | null {
  if (!isRecord(value)
    || value.manifestId !== manifest.manifestId
    || value.manifestRevision !== manifest.manifestRevision
    || value.manifestHash !== manifest.manifestHash
    || !isNullableTimestamp(value.evaluatedAt)
    || !isEvidenceStatus(value.evidenceStatus)
    || !['OBSERVED', 'NOT_OBSERVED', 'INCONCLUSIVE'].includes(String(value.effectAssessment))
    || !Array.isArray(value.recipeOutcomes)
    || value.recipeOutcomes.length > 1024
    || !Array.isArray(value.items)
    || value.items.length > 4096
    || !Array.isArray(value.recipeSummaries)
    || value.recipeSummaries.length > 1024
    || !Array.isArray(value.baselineComparisons)
    || value.baselineComparisons.length > 512) return null;
  const items = value.items.map(parseAttemptItem);
  if (items.some((item) => item === null)
    || !hasUniqueRecipeWindowItems(items as EvidenceAttemptItemView[])
    || !(items as EvidenceAttemptItemView[]).every((item) => manifest.recipes.some((recipe) =>
      recipe.recipeId === item.recipeId
      && recipe.source === item.source
      && recipe.window === item.window))) return null;
  const recipeOutcomes = value.recipeOutcomes.map((outcome: unknown) => {
    if (!isRecord(outcome)
      || typeof outcome.recipeId !== 'string' || outcome.recipeId.length === 0 || outcome.recipeId.length > 128
      || !['MET', 'NOT_MET', 'INCONCLUSIVE'].includes(String(outcome.predicateOutcome))) return null;
    const recipe = manifest.recipes.find((candidate) =>
      candidate.recipeId === outcome.recipeId && candidate.window !== 'baseline');
    return recipe && recipe.observationMode === 'WINDOWED'
      && ['PROMETHEUS', 'LOKI', 'TEMPO'].includes(recipe.source)
      ? {
        recipeId: outcome.recipeId,
        predicateOutcome: outcome.predicateOutcome as EvidencePredicateOutcome,
      }
      : null;
  });
  if (recipeOutcomes.some((outcome) => outcome === null)
    || new Set((recipeOutcomes as EvidenceLiveReportView['recipeOutcomes'])
      .map((outcome) => outcome.recipeId)).size !== recipeOutcomes.length) return null;
  const recipeSummaries = value.recipeSummaries.map(parseRecipeSummary);
  const baselineComparisons = value.baselineComparisons.map(parseBaselineComparison);
  const parsedSummaries = recipeSummaries as EvidenceRecipeSummaryView[];
  const parsedComparisons = baselineComparisons as EvidenceBaselineComparisonView[];
  const itemByKey = new Map((items as EvidenceAttemptItemView[]).map((item) => [
    recipeWindowKey(item.recipeId, item.window),
    item,
  ]));
  const expectedRecipeSummaryCount = manifest.recipes.filter((recipe) =>
    recipe.observationMode === 'WINDOWED'
      && (recipe.source === 'PROMETHEUS' || recipe.source === 'LOKI' || recipe.source === 'TEMPO')).length;
  const expectedBaselineComparisonCount = manifest.recipes.filter((recipe) =>
    recipe.window === 'active'
      && recipe.observationMode === 'WINDOWED'
      && (recipe.source === 'PROMETHEUS' || recipe.source === 'LOKI' || recipe.source === 'TEMPO')
      && manifest.recipes.some((baseline) => baseline.window === 'baseline'
        && baseline.baselineForRecipeId === recipe.recipeId)).length;
  if (recipeSummaries.some((summary) => summary === null)
    || baselineComparisons.some((comparison) => comparison === null)
    || recipeSummaries.length !== expectedRecipeSummaryCount
    || baselineComparisons.length !== expectedBaselineComparisonCount
    || !parsedSummaries.every((summary) => {
      const recipe = manifest.recipes.find((candidate) => candidate.recipeId === summary.recipeId
        && candidate.source === summary.source
        && candidate.window === summary.window
        && candidate.valueUnit === summary.valueUnit);
      if (!recipe || !isTelemetryWindowedRecipe(recipe)) return false;
      const item = itemByKey.get(recipeWindowKey(summary.recipeId, summary.window));
      if (!item) return false;
      if (summary.summary === null) return true;
      if (item.availability === 'AVAILABLE' && item.coverage === 'FULL') {
        return summary.summary.pointCount > 0;
      }
      return recipe.source === 'TEMPO'
        && item.availability === 'NO_DATA'
        && item.coverage === 'FULL'
        && summary.summary.pointCount === 0
        && summary.summary.minimum === 0
        && summary.summary.maximum === 0
        && summary.summary.latest === 0;
    })
    || !parsedComparisons.every((comparison) =>
      isDeclaredBaselineComparison(manifest, comparison)
      && comparisonAgreesWithRecipeSummaries(comparison, parsedSummaries))
    || new Set(parsedSummaries
      .map((summary) => recipeWindowKey(summary.recipeId, summary.window))).size !== recipeSummaries.length
    || new Set(parsedComparisons
      .map((comparison) => `${comparison.recipeId}\u0000${comparison.source}`)).size !== baselineComparisons.length
    || parsedSummaries.some((summary) =>
      summary.summary !== null && isPairedBaselineRecipe(manifest, summary.recipeId, summary.window)
      && !parsedComparisons.some((comparison) =>
        comparison.recipeId === summary.recipeId
        && (comparison.status === 'AVAILABLE' || comparison.status === 'COUNT_CONTEXT_ONLY')))) return null;
  return {
    manifestId: value.manifestId,
    manifestRevision: value.manifestRevision,
    manifestHash: value.manifestHash,
    evaluatedAt: value.evaluatedAt,
    evidenceStatus: value.evidenceStatus,
    effectAssessment: value.effectAssessment as EvidenceLiveReportView['effectAssessment'],
    recipeOutcomes: recipeOutcomes as EvidenceLiveReportView['recipeOutcomes'],
    items: items as EvidenceAttemptItemView[],
    recipeSummaries: parsedSummaries,
    baselineComparisons: parsedComparisons,
  };
}

export function bindEvidenceHistoryToManifests(
  manifests: readonly EvidenceManifestView[],
  reports: readonly EvidenceReportHistoryView[],
  notes: readonly EvidenceNoteView[],
): Pick<EvidencePanelMetadata, 'reports' | 'notes' | 'omittedReportCount' | 'omittedNoteCount'> | null {
  const manifestById = new Map(manifests.map((manifest) => [manifest.manifestId, manifest]));
  const verifiedReports: EvidenceReportHistoryView[] = [];
  for (const report of reports) {
    const manifest = manifestById.get(report.manifestId);
    if (!manifest) continue;
    if (manifest.manifestRevision !== report.manifestRevision || manifest.manifestHash !== report.manifestHash
      || !report.items.every((item) => manifest.recipes.some((recipe) =>
        recipe.recipeId === item.recipeId
        && recipe.source === item.source
        && recipe.window === item.window))) {
      return null;
    }
    verifiedReports.push(report);
  }
  const verifiedNotes: EvidenceNoteView[] = [];
  for (const note of notes) {
    const manifest = manifestById.get(note.manifestId);
    if (!manifest) continue;
    verifiedNotes.push(note);
  }
  return {
    reports: verifiedReports,
    notes: verifiedNotes,
    omittedReportCount: reports.length - verifiedReports.length,
    omittedNoteCount: notes.length - verifiedNotes.length,
  };
}

export function buildEvidencePanelProjection(
  manifest: EvidenceManifestView,
  reports: readonly EvidenceReportHistoryView[],
  liveReport: EvidenceLiveReportView | null = null,
): EvidencePanelProjection {
  const report = [...reports]
    .filter((entry) => entry.manifestId === manifest.manifestId
      && entry.manifestRevision === manifest.manifestRevision
      && entry.manifestHash === manifest.manifestHash)
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0] ?? null;
  const currentLiveReport = liveReport
    && liveReport.manifestId === manifest.manifestId
    && liveReport.manifestRevision === manifest.manifestRevision
    && liveReport.manifestHash === manifest.manifestHash
    ? liveReport
    : null;
  const items = currentLiveReport?.items ?? report?.items ?? [];
  const itemByKey = new Map(items.flatMap((item) => {
    const recipe = manifest.recipes.find((candidate) =>
      candidate.recipeId === item.recipeId
      && candidate.source === item.source
      && candidate.window === item.window);
    return recipe ? [[recipeWindowKey(item.recipeId, item.window), item] as const] : [];
  }));
  const baselineRecipes = manifest.recipes.filter((recipe) =>
    recipe.window === 'baseline' && recipe.baselineForRecipeId !== null);
  const comparisons = baselineRecipes.flatMap((baseline) => {
    const active = manifest.recipes.find((recipe) =>
      recipe.recipeId === baseline.baselineForRecipeId && recipe.window === 'active');
    if (!active || !areComparableBaselineRecipes(baseline, active)) return [];
    return [{
      recipeId: active.recipeId,
      source: active.source,
      valueUnit: active.valueUnit,
      lookbackSec: active.lookbackSec,
      baseline: itemByKey.get(recipeWindowKey(baseline.recipeId, 'baseline')) ?? null,
      active: itemByKey.get(recipeWindowKey(active.recipeId, 'active')) ?? null,
      numeric: currentLiveReport?.baselineComparisons.find((comparison) =>
        comparison.recipeId === active.recipeId && comparison.source === active.source
        && comparison.valueUnit === active.valueUnit) ?? null,
    }];
  });
  const currentChecks = manifest.recipes
    .filter((recipe) => recipe.observationMode === 'CURRENT')
    .map((recipe) => ({
      recipe,
      item: itemByKey.get(recipeWindowKey(recipe.recipeId, recipe.window)) ?? null,
    }));
  return {
    telemetryStatus: currentLiveReport?.evidenceStatus ?? (report?.state === 'RUNNING'
      ? 'RUNNING'
      : report?.evidenceStatus ?? 'NOT_QUERIED'),
    effectAssessment: currentLiveReport?.effectAssessment ?? 'NOT_ASSESSED',
    report,
    comparisons,
    currentChecks,
    executedRanges: items.filter((item) => {
      const recipe = manifest.recipes.find((candidate) =>
        candidate.recipeId === item.recipeId
        && candidate.source === item.source
        && candidate.window === item.window);
      return recipe?.observationMode === 'WINDOWED'
        && (item.executedStartAt !== null || item.executedEndAt !== null);
    }),
  };
}

function parseWindow(value: unknown): EvidenceWindowView | null {
  if (!isRecord(value)
    || !isWindow(value.name)
    || !['READY', 'NOT_READY', 'NOT_APPLICABLE'].includes(String(value.state))
    || !isNullableTimestamp(value.canonicalStartAt)
    || !isNullableTimestamp(value.canonicalEndAt)
    || !isNullableCode(value.reasonCode)) {
    return null;
  }
  return {
    name: value.name,
    state: value.state as EvidenceWindowView['state'],
    canonicalStartAt: value.canonicalStartAt,
    canonicalEndAt: value.canonicalEndAt,
    reasonCode: value.reasonCode,
  };
}

function parseRecipeSummary(value: unknown): EvidenceRecipeSummaryView | null {
  if (!isRecord(value)
    || typeof value.recipeId !== 'string' || value.recipeId.length === 0 || value.recipeId.length > 128
    || !isSource(value.source)
    || !isWindow(value.window)
    || typeof value.valueUnit !== 'string' || !/^[a-z0-9_]{1,32}$/u.test(value.valueUnit)) return null;
  const summary = value.summary === null ? null : parseMetricSummary(value.summary);
  if (value.summary !== null && summary === null) return null;
  return {
    recipeId: value.recipeId,
    source: value.source,
    window: value.window,
    valueUnit: value.valueUnit,
    summary,
  };
}

function parseBaselineComparison(value: unknown): EvidenceBaselineComparisonView | null {
  if (!isRecord(value)
    || typeof value.recipeId !== 'string' || value.recipeId.length === 0 || value.recipeId.length > 128
    || !isSource(value.source)
    || typeof value.valueUnit !== 'string' || !/^[a-z0-9_]{1,32}$/u.test(value.valueUnit)
    || !['AVAILABLE', 'BASELINE_UNAVAILABLE', 'BASELINE_INCOMPATIBLE', 'COUNT_CONTEXT_ONLY']
      .includes(String(value.status))
    || !isNullableCode(value.reasonCode)
    || !(value.active === null || isMetricSummary(value.active))
    || !(value.baseline === null || isMetricSummary(value.baseline))
    || !(value.delta === null || isMetricVector(value.delta))
    || !(value.percentDelta === null || isMetricPercentSummary(value.percentDelta))) return null;
  const active = value.active === null ? null : parseMetricSummary(value.active);
  const baseline = value.baseline === null ? null : parseMetricSummary(value.baseline);
  const delta = value.delta === null ? null : parseMetricVector(value.delta);
  const percentDelta = value.percentDelta === null ? null : parseMetricPercentSummary(value.percentDelta);
  if ((value.active !== null && active === null)
    || (value.baseline !== null && baseline === null)
    || (value.delta !== null && delta === null)
    || (value.percentDelta !== null && percentDelta === null)) return null;
  const status = value.status as EvidenceBaselineComparisonView['status'];
  if ((status === 'AVAILABLE'
      && (value.active === null || value.baseline === null || value.delta === null || value.percentDelta === null))
    || (status === 'COUNT_CONTEXT_ONLY'
      && (value.active === null || value.baseline === null || value.delta !== null || value.percentDelta !== null))
    || ((status === 'BASELINE_UNAVAILABLE' || status === 'BASELINE_INCOMPATIBLE')
      && (value.active !== null || value.baseline !== null || value.delta !== null || value.percentDelta !== null))) {
    return null;
  }
  return {
    recipeId: value.recipeId,
    source: value.source,
    valueUnit: value.valueUnit,
    status,
    reasonCode: value.reasonCode,
    active,
    baseline,
    delta,
    percentDelta,
  };
}

function isMetricSummary(value: unknown): value is Record<string, unknown> {
  return isMetricVector(value)
    && isFiniteNumber(value.minimum)
    && isFiniteNumber(value.maximum)
    && isFiniteNumber(value.latest)
    && value.minimum <= value.maximum
    && value.minimum <= value.latest
    && value.latest <= value.maximum;
}

function isMetricVector(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && isNonNegativeInteger(value.pointCount)
    && isFiniteNumber(value.minimum)
    && isFiniteNumber(value.maximum)
    && isFiniteNumber(value.latest);
}

function parseMetricSummary(value: unknown): EvidenceMetricSummaryView | null {
  if (!isMetricSummary(value)) return null;
  const pointCount = isNonNegativeInteger(value.pointCount) ? value.pointCount : null;
  const minimum = finiteNumber(value.minimum);
  const maximum = finiteNumber(value.maximum);
  const latest = finiteNumber(value.latest);
  if (pointCount === null || minimum === null || maximum === null || latest === null) return null;
  return {
    pointCount,
    minimum,
    maximum,
    latest,
  };
}

function parseMetricVector(value: unknown): EvidenceMetricSummaryView | null {
  if (!isMetricVector(value)) return null;
  const pointCount = isPositiveInteger(value.pointCount) ? value.pointCount : null;
  const minimum = finiteNumber(value.minimum);
  const maximum = finiteNumber(value.maximum);
  const latest = finiteNumber(value.latest);
  if (pointCount === null || minimum === null || maximum === null || latest === null) return null;
  return { pointCount, minimum, maximum, latest };
}

function isMetricPercentSummary(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && isNullableFiniteNumber(value.minimum)
    && isNullableFiniteNumber(value.maximum)
    && isNullableFiniteNumber(value.latest);
}

function parseMetricPercentSummary(
  value: unknown,
): EvidenceBaselineComparisonView['percentDelta'] {
  return isMetricPercentSummary(value)
    ? {
      minimum: toNullableFiniteNumber(value.minimum),
      maximum: toNullableFiniteNumber(value.maximum),
      latest: toNullableFiniteNumber(value.latest),
    }
    : null;
}

function toNullableFiniteNumber(value: unknown): number | null {
  return value === null ? null : finiteNumber(value);
}

function finiteNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function isDeclaredBaselineComparison(
  manifest: EvidenceManifestView,
  comparison: EvidenceBaselineComparisonView,
): boolean {
  const active = manifest.recipes.find((recipe) =>
    recipe.recipeId === comparison.recipeId
    && recipe.source === comparison.source
    && recipe.window === 'active'
    && recipe.valueUnit === comparison.valueUnit);
  const baseline = manifest.recipes.find((recipe) =>
    recipe.recipeId === comparison.recipeId
    && recipe.window === 'baseline'
    && recipe.baselineForRecipeId === comparison.recipeId);
  return active !== undefined && baseline !== undefined
    && areComparableBaselineRecipes(baseline, active);
}

function comparisonAgreesWithRecipeSummaries(
  comparison: EvidenceBaselineComparisonView,
  summaries: readonly EvidenceRecipeSummaryView[],
): boolean {
  const active = summaries.find((summary) => summary.recipeId === comparison.recipeId
    && summary.source === comparison.source && summary.window === 'active');
  const baseline = summaries.find((summary) => summary.recipeId === comparison.recipeId
    && summary.source === comparison.source && summary.window === 'baseline');
  if (!active || !baseline) return false;
  if (comparison.status === 'AVAILABLE' || comparison.status === 'COUNT_CONTEXT_ONLY') {
    if (!active.summary || !baseline.summary
      || !metricSummariesEqual(comparison.active, active.summary)
      || !metricSummariesEqual(comparison.baseline, baseline.summary)) return false;
    if (comparison.status === 'COUNT_CONTEXT_ONLY') return true;
    if (!comparison.delta || !comparison.percentDelta) return false;
    if (comparison.delta.pointCount !== Math.min(active.summary.pointCount, baseline.summary.pointCount)) {
      return false;
    }
    const expectedDelta = {
      minimum: active.summary.minimum - baseline.summary.minimum,
      maximum: active.summary.maximum - baseline.summary.maximum,
      latest: active.summary.latest - baseline.summary.latest,
    };
    if (!Object.values(expectedDelta).every(Number.isFinite)) return false;
    const percentFields = [
      ['minimum', active.summary.minimum, baseline.summary.minimum],
      ['maximum', active.summary.maximum, baseline.summary.maximum],
      ['latest', active.summary.latest, baseline.summary.latest],
    ] as const;
    return nearlyEqual(comparison.delta.minimum, expectedDelta.minimum)
      && nearlyEqual(comparison.delta.maximum, expectedDelta.maximum)
      && nearlyEqual(comparison.delta.latest, expectedDelta.latest)
      && percentFields.every(([field, activeValue, baselineValue]) => {
        const actualPercent = comparison.percentDelta?.[field];
        if (baselineValue === 0) return actualPercent === null;
        const expected = (activeValue - baselineValue) / baselineValue * 100;
        return Number.isFinite(expected)
          ? actualPercent !== null
            && actualPercent !== undefined
            && nearlyEqual(actualPercent, expected)
          : actualPercent === null;
      });
  }
  return true;
}

function metricSummariesEqual(
  left: EvidenceMetricSummaryView | null,
  right: EvidenceMetricSummaryView,
): boolean {
  return left !== null
    && left.pointCount === right.pointCount
    && left.minimum === right.minimum
    && left.maximum === right.maximum
    && left.latest === right.latest;
}

function nearlyEqual(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * Number.EPSILON * 8;
}

function hasUniqueRecipeWindowItems(items: readonly EvidenceAttemptItemView[]): boolean {
  return new Set(items.map((item) => recipeWindowKey(item.recipeId, item.window))).size === items.length;
}

function isTelemetryWindowedRecipe(recipe: EvidenceRecipeView): boolean {
  return recipe.observationMode === 'WINDOWED'
    && (recipe.source === 'PROMETHEUS' || recipe.source === 'LOKI' || recipe.source === 'TEMPO');
}

function isPairedBaselineRecipe(
  manifest: EvidenceManifestView,
  recipeId: string,
  window: EvidenceWindowName,
): boolean {
  if (window === 'baseline') return manifest.recipes.some((recipe) =>
    recipe.window === 'active' && recipe.recipeId === recipeId);
  if (window === 'active') return manifest.recipes.some((recipe) =>
    recipe.window === 'baseline' && recipe.baselineForRecipeId === recipeId);
  return false;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function parseRecipe(value: unknown): EvidenceRecipeView | null {
  if (!isRecord(value)
    || typeof value.recipeId !== 'string'
    || value.recipeId.length === 0 || value.recipeId.length > 128
    || !isSource(value.source)
    || !isWindow(value.window)
    || !['WINDOWED', 'CURRENT'].includes(String(value.observationMode))
    || typeof value.required !== 'boolean'
    || typeof value.valueUnit !== 'string' || !/^[a-z0-9_]{1,32}$/u.test(value.valueUnit)
    || !isNonNegativeInteger(value.lookbackSec)
    || !(value.renderedQuery === null
      || typeof value.renderedQuery === 'string'
        && value.renderedQuery.length > 0
        && value.renderedQuery.length <= 8192
        && !/https?:\/\/|(?:authorization|bearer|password|token)\s*[:=]/iu.test(value.renderedQuery))
    || !(value.baselineForRecipeId === null
      || typeof value.baselineForRecipeId === 'string' && value.baselineForRecipeId.length <= 128)
    || !(value.businessCheckId === null
      || value.businessCheckId === 'CATALOG_PRODUCT_LIST'
      || value.businessCheckId === 'CATALOG_BROWSE_REPORT')) {
    return null;
  }
  return {
    recipeId: value.recipeId,
    source: value.source,
    window: value.window,
    observationMode: value.observationMode as EvidenceRecipeView['observationMode'],
    required: value.required,
    valueUnit: value.valueUnit,
    lookbackSec: value.lookbackSec,
    baselineForRecipeId: value.baselineForRecipeId,
    businessCheckId: value.businessCheckId,
    renderedQuery: value.renderedQuery,
  };
}

function parseLimitation(value: unknown): EvidencePanelMetadata['manifests'][number]['limitations'][number] | null {
  if (!isRecord(value) || !isCode(value.code)
    || !(value.window === null || isWindow(value.window))) return null;
  return { code: value.code, window: value.window };
}

function parseReport(value: unknown): EvidenceReportHistoryView | null {
  if (!isRecord(value)
    || !isUuid(value.attemptId)
    || !isUuid(value.manifestId)
    || !isPositiveInteger(value.manifestRevision)
    || !isSha256(value.manifestHash)
    || !['RUNNING', 'COMPLETED', 'EVIDENCE_UNAVAILABLE', 'FAILED'].includes(String(value.state))
    || !(value.evidenceStatus === null || isEvidenceStatus(value.evidenceStatus))
    || !isTimestamp(value.requestedAt)
    || !isNullableTimestamp(value.completedAt)
    || !isNullableNonNegativeInteger(value.totalDurationMs)
    || !isNullableCode(value.failureCode)
    || !(value.operatorAuditId === null || isPositiveInteger(value.operatorAuditId))
    || !Array.isArray(value.items)
    || value.items.length > 4096) return null;
  const items = value.items.map(parseAttemptItem);
  if (items.some((item) => item === null)
    || !hasUniqueRecipeWindowItems(items as EvidenceAttemptItemView[])) return null;
  return {
    attemptId: value.attemptId,
    manifestId: value.manifestId,
    manifestRevision: value.manifestRevision,
    manifestHash: value.manifestHash,
    state: value.state as EvidenceAttemptState,
    evidenceStatus: value.evidenceStatus,
    requestedAt: value.requestedAt,
    completedAt: value.completedAt,
    totalDurationMs: value.totalDurationMs,
    failureCode: value.failureCode,
    operatorAuditId: value.operatorAuditId,
    items: items as EvidenceAttemptItemView[],
  };
}

function parseAttemptItem(value: unknown): EvidenceAttemptItemView | null {
  if (!isRecord(value)
    || typeof value.recipeId !== 'string' || value.recipeId.length === 0 || value.recipeId.length > 128
    || !isSource(value.source)
    || !isWindow(value.window)
    || !isAvailability(value.availability)
    || !['FULL', 'PARTIAL', 'NONE', 'NOT_APPLICABLE'].includes(String(value.coverage))
    || !['MET', 'NOT_MET', 'INCONCLUSIVE'].includes(String(value.predicateOutcome))
    || !isNullableCode(value.reasonCode)
    || !isNullableNonNegativeInteger(value.durationMs)
    || !isNullableTimestamp(value.queriedAt)
    || !isNullableTimestamp(value.executedStartAt)
    || !isNullableTimestamp(value.executedEndAt)) return null;
  return {
    recipeId: value.recipeId,
    source: value.source,
    window: value.window,
    availability: value.availability,
    coverage: value.coverage as EvidenceCoverage,
    predicateOutcome: value.predicateOutcome as EvidencePredicateOutcome,
    reasonCode: value.reasonCode,
    durationMs: value.durationMs,
    queriedAt: value.queriedAt,
    executedStartAt: value.executedStartAt,
    executedEndAt: value.executedEndAt,
  };
}

function parseNote(value: unknown, sourceRunId: string): EvidenceNoteView | null {
  if (!isRecord(value)
    || !isUuid(value.noteId)
    || !isUuid(value.manifestId)
    || value.sourceFaultRunId !== sourceRunId
    || !isSha256(value.requestHash)
    || !isPositiveInteger(value.operatorAuditId)
    || typeof value.text !== 'string'
    || new TextEncoder().encode(value.text).byteLength > 2048
    || !isTimestamp(value.createdAt)) return null;
  return {
    noteId: value.noteId,
    manifestId: value.manifestId,
    requestHash: value.requestHash,
    operatorAuditId: value.operatorAuditId,
    text: value.text,
    createdAt: value.createdAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isCode(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CODE_PATTERN.test(value);
}

function isNullableCode(value: unknown): value is string | null {
  return value === null || isCode(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isWindow(value: unknown): value is EvidenceWindowName {
  return value === 'baseline' || value === 'active' || value === 'recovery' || value === 'cleanup';
}

function isSource(value: unknown): value is EvidenceSourceName {
  return value === 'RUN_EVENT' || value === 'PROMETHEUS' || value === 'LOKI'
    || value === 'TEMPO' || value === 'BUSINESS_CHECK' || value === 'RESOURCE_CHECK';
}

function isAvailability(value: unknown): value is EvidenceAvailability {
  return value === 'AVAILABLE' || value === 'NO_DATA' || value === 'EVIDENCE_UNAVAILABLE'
    || value === 'INVALID_QUERY' || value === 'NOT_APPLICABLE';
}

function isEvidenceStatus(value: unknown): value is EvidenceStatus {
  return value === 'AVAILABLE' || value === 'PARTIAL'
    || value === 'EVIDENCE_UNAVAILABLE' || value === 'INVALID_QUERY';
}

function recipeWindowKey(recipeId: string, window: EvidenceWindowName): string {
  return `${recipeId}\u0000${window}`;
}
