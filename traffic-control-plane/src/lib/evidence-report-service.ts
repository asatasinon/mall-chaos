import type { EvidenceBusinessCheckResult } from './evidence-business-checks';
import {
  EvidenceBusinessCheckError,
  EvidenceBusinessChecks,
} from './evidence-business-checks';
import {
  assessEvidenceQueryCoverage,
  combineEvidenceQueryCoverage,
  compareEvidenceBaseline,
  summarizeEvidenceResult,
  type EvidenceBaselineComparison,
  type EvidenceMetricSummary,
} from './evidence-query-coverage';
import {
  EvidenceQueryClientError,
  EvidenceQueryClients,
  type EvidenceQueryClientResponse,
} from './evidence-query-clients';
import {
  aggregateEvidenceReportStatus,
  evaluateEvidenceEffectRule,
  evaluateEvidenceRecipePredicate,
  type EvidenceRecipeEvaluation,
  type EvidenceReportStatusFact,
} from './evidence-evaluator';
import {
  adaptCurrentBusinessCheckObservation,
  adaptRunTimelineObservation,
} from './evidence-observation-adapters';
import {
  EvidenceQueryPreflightError,
  loadEvidenceDatabaseNow,
  preflightEvidenceQuery,
} from './evidence-query-preflight';
import type { EvidenceSourceConfig, EvidenceWebConfig } from './evidence-web-config';
import { readEvidenceWebConfig } from './evidence-web-config';
import type { EvidenceQueryRange } from './evidence-query-clients';
import type {
  EvidenceAttemptItemRecord,
  EvidenceAttemptRecord,
  EvidenceEffectAssessment,
  EvidenceManifestRecord,
  EvidenceStatus,
  EvidenceStoredContractSnapshotRecord,
  RenderedEvidenceRecipe,
} from './evidence-types';
import {
  EvidenceTypeError,
  canonicalizeEvidenceRenderedRecipes,
  parseEvidenceManifest,
  parseEvidenceStoredContractSnapshot,
} from './evidence-types';
import {
  SqlEvidenceRepository,
  type CreateEvidenceAttemptInput,
} from './evidence-repository';

export type EvidenceReportServiceErrorCode =
  | 'EVIDENCE_REPORT_BUSY'
  | 'EVIDENCE_REPORT_CANCELLED'
  | 'EVIDENCE_REPORT_MANIFEST_INVALID'
  | 'EVIDENCE_REPORT_DATABASE_TIME_UNAVAILABLE'
  | 'EVIDENCE_REPORT_EXECUTION_DISABLED';

export class EvidenceReportServiceError extends Error {
  constructor(readonly code: EvidenceReportServiceErrorCode) {
    super(code);
    this.name = 'EvidenceReportServiceError';
  }
}

export interface EvidenceReportExecution {
  readonly manifestId: string;
  readonly manifestRevision: number;
  readonly manifestHash: string;
  readonly evaluatedAt: string | null;
  readonly evidenceStatus: EvidenceStatus;
  readonly effectAssessment: EvidenceEffectAssessment;
  readonly recipeOutcomes: ReturnType<typeof evaluateEvidenceEffectRule>['recipeOutcomes'];
  readonly items: readonly EvidenceAttemptItemRecord[];
  readonly recipeSummaries: readonly EvidenceRecipeSummary[];
  readonly baselineComparisons: readonly EvidenceBaselineReportComparison[];
}

export interface EvidenceRecipeSummary {
  readonly recipeId: string;
  readonly source: 'PROMETHEUS' | 'LOKI' | 'TEMPO';
  readonly window: RenderedEvidenceRecipe['window'];
  readonly valueUnit: string;
  readonly summary: EvidenceMetricSummary | null;
}

export interface EvidenceBaselineReportComparison extends EvidenceBaselineComparison {
  readonly recipeId: string;
  readonly source: 'PROMETHEUS' | 'LOKI' | 'TEMPO';
  readonly valueUnit: string;
}

export type ExecuteEvidenceAttemptInput = Omit<CreateEvidenceAttemptInput, 'totalTimeoutMs'>;

export interface EvidenceReportAttemptExecution {
  readonly attempt: EvidenceAttemptRecord;
  readonly replayed: boolean;
  readonly report: EvidenceReportExecution | null;
}

type QueryAdapter = Pick<EvidenceQueryClients, 'query'>;
type BusinessCheckAdapter = Pick<EvidenceBusinessChecks, 'check'>;
type EvidenceAttemptRepository = Pick<
  SqlEvidenceRepository,
  | 'createReportAttempt'
  | 'getReportAttemptByIdempotencyKey'
  | 'completeReportAttempt'
  | 'getManifest'
  | 'loadContractSnapshot'
>;
type RemoteSource = 'PROMETHEUS' | 'LOKI' | 'TEMPO' | 'BUSINESS_CHECK';

export interface EvidenceReportServiceOptions {
  readonly getConfig?: () => EvidenceWebConfig;
  readonly loadDatabaseNow?: () => Promise<string>;
  readonly createQueryAdapter?: (config: EvidenceWebConfig) => QueryAdapter;
  readonly createBusinessCheckAdapter?: (config: EvidenceWebConfig) => BusinessCheckAdapter;
  readonly repository?: EvidenceAttemptRepository;
  readonly monotonicNow?: () => number;
}

export class EvidenceReportService {
  private activeReports = 0;
  private readonly sourceSemaphores: Readonly<Record<RemoteSource, AbortableSemaphore>> = {
    PROMETHEUS: new AbortableSemaphore(2),
    LOKI: new AbortableSemaphore(2),
    TEMPO: new AbortableSemaphore(2),
    BUSINESS_CHECK: new AbortableSemaphore(2),
  };
  private readonly getConfig: () => EvidenceWebConfig;
  private readonly loadDatabaseNow: () => Promise<string>;
  private readonly createQueryAdapter: (config: EvidenceWebConfig) => QueryAdapter;
  private readonly createBusinessCheckAdapter: (config: EvidenceWebConfig) => BusinessCheckAdapter;
  private readonly repository: EvidenceAttemptRepository;
  private readonly monotonicNow: () => number;

  constructor(options: EvidenceReportServiceOptions = {}) {
    this.getConfig = options.getConfig ?? readEvidenceWebConfig;
    this.loadDatabaseNow = options.loadDatabaseNow ?? (() => loadEvidenceDatabaseNow());
    this.createQueryAdapter = options.createQueryAdapter
      ?? ((config) => new EvidenceQueryClients(config));
    this.createBusinessCheckAdapter = options.createBusinessCheckAdapter
      ?? ((config) => new EvidenceBusinessChecks(config));
    this.repository = options.repository ?? new SqlEvidenceRepository();
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  async execute(
    manifestValue: EvidenceManifestRecord,
    snapshotValue: EvidenceStoredContractSnapshotRecord,
    signal?: AbortSignal,
  ): Promise<EvidenceReportExecution> {
    const config = this.getConfig();
    return this.withReportSlot(config, () =>
      this.executeWithConfig(manifestValue, snapshotValue, config, signal));
  }

  async executeAttempt(
    input: ExecuteEvidenceAttemptInput,
    signal?: AbortSignal,
  ): Promise<EvidenceReportAttemptExecution> {
    const config = this.getConfig();
    if (!config.queryEnabled) {
      throw new EvidenceReportServiceError('EVIDENCE_REPORT_EXECUTION_DISABLED');
    }
    const existing = await this.repository.getReportAttemptByIdempotencyKey(input);
    if (existing) return { attempt: existing, replayed: true, report: null };
    if (!config.executionEnabled) {
      throw new EvidenceReportServiceError('EVIDENCE_REPORT_EXECUTION_DISABLED');
    }
    return this.withReportSlot(config, async () => {
      if (signal?.aborted) throw new EvidenceReportServiceError('EVIDENCE_REPORT_CANCELLED');
      const startedAt = this.monotonicNow();
      const created = await this.repository.createReportAttempt({
        ...input,
        totalTimeoutMs: config.totalTimeoutMs,
      }, false);
      if (!created.created) {
        return { attempt: created.attempt, replayed: true, report: null };
      }

      try {
        const manifest = await this.repository.getManifest(input.sourceFaultRunId, input.manifestId);
        const snapshot = await this.repository.loadContractSnapshot(input.sourceFaultRunId);
        if (!manifest || !snapshot) {
          throw new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID');
        }
        const remainingTimeoutMs = Math.max(
          0,
          config.totalTimeoutMs - elapsedMs(startedAt, this.monotonicNow()),
        );
        const report = await this.executeWithConfig(
          manifest,
          snapshot,
          config,
          signal,
          remainingTimeoutMs,
        );
        const attempt = await this.repository.completeReportAttempt({
          attemptId: created.attempt.attemptId,
          state: report.evidenceStatus === 'EVIDENCE_UNAVAILABLE'
            ? 'EVIDENCE_UNAVAILABLE'
            : 'COMPLETED',
          evidenceStatus: report.evidenceStatus,
          failureCode: null,
          totalDurationMs: elapsedMs(startedAt, this.monotonicNow()),
          items: report.items,
        });
        return { attempt, replayed: false, report };
      } catch (error) {
        if (!(error instanceof EvidenceReportServiceError)) throw error;
        const failureCode = error.code === 'EVIDENCE_REPORT_CANCELLED'
          ? 'EXECUTION_CANCELLED'
          : error.code === 'EVIDENCE_REPORT_DATABASE_TIME_UNAVAILABLE'
            ? 'DATABASE_TIME_UNAVAILABLE'
            : 'FROZEN_MANIFEST_INVALID';
        const attempt = await this.repository.completeReportAttempt({
          attemptId: created.attempt.attemptId,
          state: 'FAILED',
          evidenceStatus: null,
          failureCode,
          totalDurationMs: elapsedMs(startedAt, this.monotonicNow()),
          items: [],
        });
        return { attempt, replayed: false, report: null };
      }
    });
  }

  private async withReportSlot<T>(
    config: EvidenceWebConfig,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.activeReports >= config.maxConcurrentReports) {
      throw new EvidenceReportServiceError('EVIDENCE_REPORT_BUSY');
    }
    this.activeReports += 1;
    try {
      return await operation();
    } finally {
      this.activeReports -= 1;
    }
  }

  private async executeWithConfig(
    manifestValue: EvidenceManifestRecord,
    snapshotValue: EvidenceStoredContractSnapshotRecord,
    config: EvidenceWebConfig,
    signal?: AbortSignal,
    timeoutMs = config.totalTimeoutMs,
  ): Promise<EvidenceReportExecution> {
    if (signal?.aborted) throw new EvidenceReportServiceError('EVIDENCE_REPORT_CANCELLED');
    let manifest: EvidenceManifestRecord;
    let snapshot: EvidenceStoredContractSnapshotRecord;
    try {
      manifest = parseEvidenceManifest(manifestValue);
      snapshot = parseEvidenceStoredContractSnapshot({
        ...snapshotValue,
        rendererRevision: snapshotValue.renderedPlan.rendererRevision,
        evaluationRevision: snapshotValue.renderedPlan.evaluationRevision,
      });
      assertFrozenManifestPair(manifest, snapshot);
    } catch (error) {
      if (error instanceof EvidenceTypeError) {
        throw new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID');
      }
      throw error;
    }

    if (timeoutMs === 0) {
      return buildExecution(
        manifest,
        snapshot,
        manifest.recipes.map((recipe) => unavailableItem(recipe, 'REPORT_DEADLINE_EXCEEDED')),
        null,
        new Map(),
      );
    }

    const controller = new AbortController();
    let databaseNow: string | null = null;
    let deadlineExceeded = false;
    let cancelExecution!: () => void;
    const cancellation = new Promise<never>((_, reject) => {
      cancelExecution = () => reject(new EvidenceReportServiceError('EVIDENCE_REPORT_CANCELLED'));
    });
    const abortExternal = () => {
      controller.abort();
      cancelExecution();
    };
    signal?.addEventListener('abort', abortExternal, { once: true });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'DEADLINE'>((resolve) => {
      timeoutHandle = setTimeout(() => {
        deadlineExceeded = true;
        controller.abort();
        resolve('DEADLINE');
      }, timeoutMs);
    });

    try {
      const items = new Map<string, EvidenceAttemptItemRecord>();
      const sourceResults = new Map<string, EvidenceQueryClientResponse>();
      const work = this.executeRecipes(
        manifest,
        snapshot,
        config,
        controller.signal,
        items,
        sourceResults,
        (value) => { databaseNow = value; },
        () => deadlineExceeded,
      );
      const finished = work.then(() => 'COMPLETE' as const);
      const completion = await Promise.race([finished, deadline, cancellation]);
      if (completion === 'DEADLINE') {
        return buildExecution(manifest, snapshot, [...items.values()], databaseNow, sourceResults);
      }
      const itemList = [...items.values()];
      if (itemList.length !== manifest.recipes.length) {
        throw new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID');
      }
      return buildExecution(manifest, snapshot, itemList, databaseNow, sourceResults);
    } catch (error) {
      if (error instanceof EvidenceReportServiceError) throw error;
      if (error instanceof EvidenceQueryPreflightError
        && (error.code === 'EVIDENCE_DATABASE_TIME_UNAVAILABLE'
          || error.code === 'EVIDENCE_DATABASE_TIME_INVALID')) {
        throw new EvidenceReportServiceError('EVIDENCE_REPORT_DATABASE_TIME_UNAVAILABLE');
      }
      if (error instanceof EvidenceQueryPreflightError
        && error.code === 'EVIDENCE_QUERY_PREFLIGHT_INVALID_RECIPE') {
        throw new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID');
      }
      throw error;
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      signal?.removeEventListener('abort', abortExternal);
    }
  }

  private async executeRecipes(
    manifest: EvidenceManifestRecord,
    snapshot: EvidenceStoredContractSnapshotRecord,
    config: EvidenceWebConfig,
    signal: AbortSignal,
    itemMap: Map<string, EvidenceAttemptItemRecord>,
    sourceResults: Map<string, EvidenceQueryClientResponse>,
    onDatabaseNow: (value: string) => void,
    deadlineExceeded: () => boolean,
  ): Promise<void> {
    const recipeLimit = new AbortableSemaphore(config.maxParallelRecipes);
    const queryAdapter = this.createQueryAdapter(config);
    const businessChecks = this.createBusinessCheckAdapter(config);
    const databaseNow = await this.loadDatabaseNow();
    onDatabaseNow(databaseNow);
    const windows = new Map(manifest.windows.map((window) => [window.name, window]));

    await Promise.all(manifest.recipes.map(async (recipe) => {
      const key = itemKey(recipe);
      try {
        const releaseRecipe = await recipeLimit.acquire(signal);
        try {
          const item = await this.executeRecipe(
            recipe,
            manifest,
            snapshot,
            windows,
            config,
            queryAdapter,
            businessChecks,
            databaseNow,
            signal,
            deadlineExceeded,
            sourceResults,
          );
          itemMap.set(key, item);
        } finally {
          releaseRecipe();
        }
      } catch (error) {
        if (signal.aborted && deadlineExceeded()) {
          itemMap.set(key, unavailableItem(recipe, 'REPORT_DEADLINE_EXCEEDED'));
          return;
        }
        throw error;
      }
    }));
  }

  private async executeRecipe(
    recipe: RenderedEvidenceRecipe,
    manifest: EvidenceManifestRecord,
    snapshot: EvidenceStoredContractSnapshotRecord,
    windows: ReadonlyMap<RenderedEvidenceRecipe['window'], EvidenceManifestRecord['windows'][number]>,
    config: EvidenceWebConfig,
    queryAdapter: QueryAdapter,
    businessChecks: BusinessCheckAdapter,
    databaseNow: string,
    signal: AbortSignal,
    deadlineExceeded: () => boolean,
    sourceResults: Map<string, EvidenceQueryClientResponse>,
  ): Promise<EvidenceAttemptItemRecord> {
    const itemStartedAt = this.monotonicNow();
    const window = windows.get(recipe.window);
    if (!window) throw new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID');

    if (recipe.source === 'RUN_EVENT') {
      const observation = adaptRunTimelineObservation(
        recipe,
        window,
        manifest.timeline,
        snapshot.evidence.effectRule.recipeIds,
      );
      return {
        recipeId: recipe.recipeId,
        source: recipe.source,
        window: recipe.window,
        availability: observation.availability,
        coverage: observation.coverage,
        predicateOutcome: observation.predicateOutcome,
        reasonCode: observation.reasonCode,
        durationMs: elapsedMs(itemStartedAt, this.monotonicNow()),
        queriedAt: null,
        executedStartAt: window.canonicalStartAt,
        executedEndAt: window.canonicalEndAt,
      };
    }

    if (recipe.source === 'BUSINESS_CHECK') {
      if (!config.queryEnabled || !config.executionEnabled) {
        return unavailableItem(recipe, 'QUERY_EXECUTION_DISABLED');
      }
      try {
        const result = await this.sourceSemaphores.BUSINESS_CHECK.runExclusive(
          () => businessChecks.check(recipe, databaseNow, signal),
          signal,
        );
        return toBusinessCheckItem(
          recipe,
          result,
          snapshot.evidence.effectRule.recipeIds,
          itemStartedAt,
          this.monotonicNow(),
        );
      } catch (error) {
        if (error instanceof EvidenceBusinessCheckError) {
          return unavailableItem(
            recipe,
            deadlineExceeded() ? 'REPORT_DEADLINE_EXCEEDED' : error.code,
            databaseNow,
            elapsedMs(itemStartedAt, this.monotonicNow()),
          );
        }
        if (signal.aborted && deadlineExceeded()) {
          return unavailableItem(
            recipe,
            'REPORT_DEADLINE_EXCEEDED',
            databaseNow,
            elapsedMs(itemStartedAt, this.monotonicNow()),
          );
        }
        throw error;
      }
    }

    if (recipe.source !== 'PROMETHEUS' && recipe.source !== 'LOKI' && recipe.source !== 'TEMPO') {
      throw new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID');
    }
    const sourceConfig = sourceConfigFor(recipe.source, config);
    const preflight = preflightEvidenceQuery(recipe, window, sourceConfig, databaseNow);
    if (!config.queryEnabled || !config.executionEnabled) {
      return unavailableItem(recipe, 'QUERY_EXECUTION_DISABLED');
    }
    if (!preflight.shouldQuery) {
      return {
        recipeId: recipe.recipeId,
        source: recipe.source,
        window: recipe.window,
        availability: preflight.availabilityHint ?? (
          window.state === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'EVIDENCE_UNAVAILABLE'
        ),
        coverage: preflight.coverageHint ?? 'NONE',
        predicateOutcome: preflight.predicateOutcome ?? 'INCONCLUSIVE',
        reasonCode: preflight.reasonCodes[0] ?? null,
        durationMs: elapsedMs(itemStartedAt, this.monotonicNow()),
        queriedAt: null,
        executedStartAt: null,
        executedEndAt: null,
      };
    }

    const range: EvidenceQueryRange = {
      startAt: preflight.executedStartAt!,
      endAt: preflight.executedEndAt!,
    };
    let result: EvidenceQueryClientResponse;
    try {
      result = await this.sourceSemaphores[recipe.source].runExclusive(
        () => queryAdapter.query(recipe, range, signal),
        signal,
      );
    } catch (error) {
      if (error instanceof EvidenceQueryClientError) {
        const reasonCode = error.code === 'INVALID_QUERY'
          ? 'SOURCE_QUERY_REJECTED'
          : deadlineExceeded() ? 'REPORT_DEADLINE_EXCEEDED' : error.code;
        return unavailableItem(
          recipe,
          reasonCode,
          databaseNow,
          elapsedMs(itemStartedAt, this.monotonicNow()),
          range,
        );
      }
      if (signal.aborted && deadlineExceeded()) {
        return unavailableItem(
          recipe,
          'REPORT_DEADLINE_EXCEEDED',
          databaseNow,
          elapsedMs(itemStartedAt, this.monotonicNow()),
          range,
        );
      }
      throw error;
    }
    const sourceCoverage = assessEvidenceQueryCoverage(result);
    const combined = combineEvidenceQueryCoverage(preflight, sourceCoverage);
    sourceResults.set(itemKey(recipe), result);
    const availability = combined.availability ?? sourceCoverage.availability;
    const predicateOutcome = evaluateEvidenceRecipePredicate({
      recipe,
      availability,
      coverage: combined.coverage,
      result,
    });
    return {
      recipeId: recipe.recipeId,
      source: recipe.source,
      window: recipe.window,
      availability,
      coverage: combined.coverage,
      predicateOutcome: combined.predicateOutcome ?? predicateOutcome,
      reasonCode: combined.reasonCodes[0] ?? null,
      durationMs: elapsedMs(itemStartedAt, this.monotonicNow()),
      queriedAt: databaseNow,
      executedStartAt: preflight.executedStartAt,
      executedEndAt: preflight.executedEndAt,
    };
  }
}

let defaultEvidenceReportService: EvidenceReportService | undefined;

export function getEvidenceReportService(): EvidenceReportService {
  defaultEvidenceReportService ??= new EvidenceReportService();
  return defaultEvidenceReportService;
}

function buildExecution(
  manifest: EvidenceManifestRecord,
  snapshot: EvidenceStoredContractSnapshotRecord,
  completedItems: readonly EvidenceAttemptItemRecord[],
  evaluatedAt: string | null,
  sourceResults: ReadonlyMap<string, EvidenceQueryClientResponse>,
): EvidenceReportExecution {
  const itemMap = new Map(completedItems.map((item) => [itemKey(item), item]));
  const items = manifest.recipes.map((recipe) => itemMap.get(itemKey(recipe))
    ?? unavailableItem(recipe, 'REPORT_DEADLINE_EXCEEDED'));
  const facts: EvidenceReportStatusFact[] = manifest.recipes.map((recipe) => {
    const item = itemMap.get(itemKey(recipe))
      ?? unavailableItem(recipe, 'REPORT_DEADLINE_EXCEEDED');
    return {
      source: recipe.source,
      window: recipe.window,
      observationMode: recipe.observationMode,
      required: recipe.required,
      availability: item.availability,
      coverage: item.coverage,
    };
  });
  const evaluations: EvidenceRecipeEvaluation[] = manifest.recipes.flatMap((recipe) => {
    const item = itemMap.get(itemKey(recipe));
    if (!item || recipe.window === 'baseline') return [];
    return [{
      recipeId: recipe.recipeId,
      source: recipe.source,
      window: recipe.window,
      observationMode: recipe.observationMode,
      predicateOutcome: item.predicateOutcome,
    }];
  });
  const effect = evaluateEvidenceEffectRule(
    snapshot.evidence.effectRule.mode,
    snapshot.evidence.effectRule.recipeIds,
    evaluations,
  );
  const baselineComparisons = manifest.recipes.flatMap((activeRecipe) => {
    if (activeRecipe.window !== 'active'
      || activeRecipe.observationMode !== 'WINDOWED'
      || (activeRecipe.source !== 'PROMETHEUS'
        && activeRecipe.source !== 'LOKI'
        && activeRecipe.source !== 'TEMPO')) return [];
    const baselineRecipe = manifest.recipes.find((candidate) =>
      candidate.window === 'baseline'
      && candidate.baselineForRecipeId === activeRecipe.recipeId);
    if (!baselineRecipe) return [];
    const activeItem = itemMap.get(itemKey(activeRecipe)) ?? unavailableItem(activeRecipe, 'REPORT_DEADLINE_EXCEEDED');
    const baselineItem = itemMap.get(itemKey(baselineRecipe)) ?? unavailableItem(baselineRecipe, 'REPORT_DEADLINE_EXCEEDED');
    const comparison = compareEvidenceBaseline(
      activeRecipe,
      baselineRecipe,
      sourceResults.get(itemKey(activeRecipe)) ?? null,
      sourceResults.get(itemKey(baselineRecipe)) ?? null,
      toCoverageAssessment(activeItem),
      toCoverageAssessment(baselineItem),
    );
    const completeComparison = comparison.status === 'AVAILABLE'
      || comparison.status === 'COUNT_CONTEXT_ONLY';
    return [{
      recipeId: activeRecipe.recipeId,
      source: activeRecipe.source,
      valueUnit: activeRecipe.valueUnit,
      ...comparison,
      active: completeComparison ? comparison.active : null,
      baseline: completeComparison ? comparison.baseline : null,
    }];
  });
  const pairedRecipeKeys = new Set<string>();
  const displayableComparisonKeys = new Set<string>();
  for (const comparison of baselineComparisons) {
    const activeRecipe = manifest.recipes.find((recipe) =>
      recipe.recipeId === comparison.recipeId && recipe.window === 'active');
    const baselineRecipe = manifest.recipes.find((recipe) =>
      recipe.window === 'baseline' && recipe.baselineForRecipeId === comparison.recipeId);
    if (!activeRecipe || !baselineRecipe) continue;
    pairedRecipeKeys.add(itemKey(activeRecipe));
    pairedRecipeKeys.add(itemKey(baselineRecipe));
    if (comparison.status === 'AVAILABLE' || comparison.status === 'COUNT_CONTEXT_ONLY') {
      displayableComparisonKeys.add(itemKey(activeRecipe));
      displayableComparisonKeys.add(itemKey(baselineRecipe));
    }
  }
  const recipeSummaries = manifest.recipes.flatMap((recipe) => {
    if (recipe.observationMode !== 'WINDOWED'
      || (recipe.source !== 'PROMETHEUS' && recipe.source !== 'LOKI' && recipe.source !== 'TEMPO')) {
      return [];
    }
    const item = itemMap.get(itemKey(recipe));
    const result = sourceResults.get(itemKey(recipe));
    const completeEmptyCount = recipe.projection === 'COUNT'
      && result?.source === 'TEMPO'
      && result.traceCount === 0
      && item?.availability === 'NO_DATA'
      && item.coverage === 'FULL';
    const comparisonAllowsSummary = !pairedRecipeKeys.has(itemKey(recipe))
      || displayableComparisonKeys.has(itemKey(recipe));
    const summary = comparisonAllowsSummary
      && (item?.availability === 'AVAILABLE' && item.coverage === 'FULL' || completeEmptyCount)
      && result
      ? summarizeEvidenceResult(result)
      : null;
    return [{
      recipeId: recipe.recipeId,
      source: recipe.source,
      window: recipe.window,
      valueUnit: recipe.valueUnit,
      summary,
    }];
  });
  return {
    manifestId: manifest.manifestId,
    manifestRevision: manifest.manifestRevision,
    manifestHash: manifest.manifestHash,
    evaluatedAt,
    evidenceStatus: aggregateEvidenceReportStatus(facts),
    effectAssessment: effect.assessment,
    recipeOutcomes: effect.recipeOutcomes,
    items,
    recipeSummaries,
    baselineComparisons,
  };
}

function toCoverageAssessment(item: EvidenceAttemptItemRecord) {
  return {
    availability: item.availability,
    coverage: item.coverage,
    reasonCodes: [],
  };
}

function toBusinessCheckItem(
  recipe: RenderedEvidenceRecipe,
  result: EvidenceBusinessCheckResult,
  effectRuleRecipeIds: readonly string[],
  startedAt: number,
  finishedAt: number,
): EvidenceAttemptItemRecord {
  const observation = adaptCurrentBusinessCheckObservation(recipe, result, effectRuleRecipeIds);
  return {
    recipeId: recipe.recipeId,
    source: recipe.source,
    window: recipe.window,
    availability: 'AVAILABLE',
    coverage: 'FULL',
    predicateOutcome: 'INCONCLUSIVE',
    reasonCode: observation.reasonCode,
    durationMs: elapsedMs(startedAt, finishedAt),
    queriedAt: observation.checkedAt,
    executedStartAt: null,
    executedEndAt: null,
  };
}

function unavailableItem(
  recipe: Pick<RenderedEvidenceRecipe, 'recipeId' | 'source' | 'window'>,
  reasonCode: string,
  queriedAt: string | null = null,
  durationMs: number | null = null,
  executedRange: EvidenceQueryRange | null = null,
): EvidenceAttemptItemRecord {
  return {
    recipeId: recipe.recipeId,
    source: recipe.source,
    window: recipe.window,
    availability: 'EVIDENCE_UNAVAILABLE',
    coverage: 'NONE',
    predicateOutcome: 'INCONCLUSIVE',
    reasonCode,
    durationMs,
    queriedAt,
    executedStartAt: executedRange?.startAt ?? null,
    executedEndAt: executedRange?.endAt ?? null,
  };
}

function sourceConfigFor(
  source: 'PROMETHEUS' | 'LOKI' | 'TEMPO',
  config: EvidenceWebConfig,
): EvidenceSourceConfig {
  switch (source) {
    case 'PROMETHEUS': return config.prometheus;
    case 'LOKI': return config.loki;
    case 'TEMPO': return config.tempo;
  }
}

function assertFrozenManifestPair(
  manifest: EvidenceManifestRecord,
  snapshot: EvidenceStoredContractSnapshotRecord,
): void {
  if (manifest.sourceFaultRunId !== snapshot.sourceFaultRunId
    || manifest.snapshotId !== snapshot.snapshotId
    || manifest.scenario !== snapshot.scenario
    || manifest.contractRevision !== snapshot.contractRevision
    || manifest.contractHash !== snapshot.contractHash
    || manifest.renderedPlanHash !== snapshot.renderedPlanHash
    || canonicalizeEvidenceRenderedRecipes(manifest.recipes)
      !== canonicalizeEvidenceRenderedRecipes(snapshot.renderedPlan.recipes)) {
    throw new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID');
  }
  const recipeIds = new Set(manifest.recipes.map((recipe) => recipe.recipeId));
  if (snapshot.evidence.effectRule.recipeIds.some((recipeId) => !recipeIds.has(recipeId))) {
    throw new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID');
  }
}

function itemKey(item: Pick<EvidenceAttemptItemRecord, 'recipeId' | 'window'>): string {
  return `${item.recipeId}\u0000${item.window}`;
}

function elapsedMs(startedAt: number, finishedAt: number): number {
  return Math.max(0, Math.min(0xffff_ffff, Math.round(finishedAt - startedAt)));
}

class AbortableSemaphore {
  private active = 0;
  private readonly waiters: Array<{
    readonly resolve: (release: () => void) => void;
    readonly reject: (error: Error) => void;
    readonly signal: AbortSignal;
    readonly onAbort: () => void;
  }> = [];

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('EVIDENCE_SEMAPHORE_LIMIT_INVALID');
  }

  async runExclusive<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error('EVIDENCE_SEMAPHORE_ABORTED'));
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error('EVIDENCE_SEMAPHORE_ABORTED'));
        },
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift()!;
        waiter.signal.removeEventListener('abort', waiter.onAbort);
        if (waiter.signal.aborted) {
          waiter.reject(new Error('EVIDENCE_SEMAPHORE_ABORTED'));
          continue;
        }
        waiter.resolve(this.createRelease());
        return;
      }
      this.active -= 1;
    };
  }
}
