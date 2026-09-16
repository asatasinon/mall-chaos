import { randomUUID } from 'node:crypto';
import { env } from './env';
import {
  BaselineCaptureError,
  assertBaselineSourceRun,
} from './baseline-capture-errors';
import {
  normalizeBaselineCaptureEventPayload,
} from './fault-run-event-contract';
import {
  foldBaselineEvents,
  type FoldedBaselineFacts,
} from './baseline-event-folding';
import {
  getBaselineMetadata,
  loadBaselineWarmupMetadata,
  type BaselineMetadata,
  type BaselineWarmupMetadata,
} from './baseline-metadata';
import {
  BASELINE_SCHEMA_REVISION,
  type BaselineAlertSummary,
  type BaselineLimitation,
  type BaselineObservationCheck,
  type BaselineObservationSummary,
  type BaselineResidualResource,
  type BaselineRollbackStep,
  type ScenarioBaseline,
} from './baseline-schema';
import {
  SqlBaselineRepository,
  type BaselineCaptureLock,
  type BaselineRepository,
} from './baseline-repository';
import {
  appendFaultRunEvent,
  loadFaultRun,
  loadFaultRunAudit,
  loadFaultRunEvents,
  type FaultRunAuditRecord,
  type FaultRunEventRecord,
  type FaultRunRecord,
} from './fault-run-repository';

export interface BaselineCaptureDependencies {
  repository?: BaselineRepository;
  loadRun?: (faultRunId: string) => Promise<FaultRunRecord | null>;
  loadEvents?: (faultRunId: string) => Promise<FaultRunEventRecord[]>;
  loadAudit?: (faultRunId: string) => Promise<FaultRunAuditRecord | null>;
  loadMetadata?: () => BaselineMetadata;
  loadWarmupMetadata?: () => Promise<BaselineWarmupMetadata>;
  appendEvent?: (faultRunId: string, eventType: string, payload?: unknown) => Promise<void>;
  now?: () => Date;
  createBaselineId?: () => string;
  captureEnabled?: () => boolean;
}

export interface CaptureScenarioBaselineOptions {
  operatorAuditId?: number | null;
  skipLock?: boolean;
}

export interface CaptureScenarioBaselineResult {
  baseline: ScenarioBaseline;
  created: boolean;
}

const defaultDependencies: Required<BaselineCaptureDependencies> = {
  repository: new SqlBaselineRepository(),
  loadRun: loadFaultRun,
  loadEvents: loadFaultRunEvents,
  loadAudit: loadFaultRunAudit,
  loadMetadata: getBaselineMetadata,
  loadWarmupMetadata: loadBaselineWarmupMetadata,
  appendEvent: appendFaultRunEvent,
  now: () => new Date(),
  createBaselineId: randomUUID,
  captureEnabled: () => env.BASELINE_CAPTURE_ENABLED,
};

export async function captureScenarioBaseline(
  sourceFaultRunId: string,
  options: CaptureScenarioBaselineOptions = {},
  dependencies: BaselineCaptureDependencies = {},
): Promise<CaptureScenarioBaselineResult> {
  const deps = { ...defaultDependencies, ...dependencies };
  const lock = deps.repository as BaselineRepository & Partial<BaselineCaptureLock>;
  if (lock.withSourceFaultRunLock && !options.skipLock) {
    return lock.withSourceFaultRunLock(
      sourceFaultRunId,
      () => captureScenarioBaselineUnlocked(sourceFaultRunId, options, deps),
    );
  }
  return captureScenarioBaselineUnlocked(sourceFaultRunId, options, deps);
}

async function captureScenarioBaselineUnlocked(
  sourceFaultRunId: string,
  options: CaptureScenarioBaselineOptions,
  deps: Required<BaselineCaptureDependencies>,
): Promise<CaptureScenarioBaselineResult> {
  const existing = await deps.repository.findBySourceFaultRunId(sourceFaultRunId);
  if (existing) return { baseline: existing, created: false };
  if (!deps.captureEnabled()) throw new BaselineCaptureError('BASELINE_CAPTURE_DISABLED');

  let run: FaultRunRecord | null;
  try {
    run = await deps.loadRun(sourceFaultRunId);
  } catch (error) {
    await appendCaptureFailureEvent(deps, sourceFaultRunId, error);
    throw error;
  }
  assertBaselineSourceRun(run);
  const baselineId = deps.createBaselineId();
  try {
    await appendCaptureEvent(deps, sourceFaultRunId, 'BASELINE_CAPTURE_REQUESTED', {
      baselineId,
      operatorAuditId: options.operatorAuditId ?? run.operatorAuditId,
    });
    const [events, audit, metadata, warmupMetadata] = await Promise.all([
      deps.loadEvents(sourceFaultRunId),
      deps.loadAudit(sourceFaultRunId),
      loadCaptureMetadata(deps),
      deps.loadWarmupMetadata(),
    ]);
    const facts = foldBaselineEvents(run, events);
    const limitations = collectLimitations(facts, metadata, warmupMetadata, audit);
    await appendCaptureEvent(deps, sourceFaultRunId, 'BASELINE_RUNTIME_SUMMARY_RECORDED', {
      limitationCount: limitations.length,
      failureClassCount: facts.outcome.failureClasses.length,
      requestSummaryAvailable: facts.requestSummary !== null,
    });
    const baseline = buildScenarioBaseline(
      sourceFaultRunId,
      run,
      facts,
      metadata,
      warmupMetadata,
      limitations,
      audit,
      options.operatorAuditId,
      baselineId,
      deps,
    );
    await appendCaptureEvent(deps, sourceFaultRunId, 'BASELINE_OBSERVATION_CHECK_RECORDED', {
      limitationCount: limitations.length,
    });
    const saved = await deps.repository.save(baseline);
    if (saved.created) {
      await appendCaptureEvent(
        deps,
        sourceFaultRunId,
        baseline.captureStatus === 'INCOMPLETE'
          ? 'BASELINE_CAPTURE_INCOMPLETE' : 'BASELINE_CAPTURE_COMPLETED',
        { captureStatus: baseline.captureStatus, limitationCount: limitations.length },
      );
    }
    return saved;
  } catch (error) {
    await appendCaptureFailureEvent(deps, sourceFaultRunId, error);
    throw error;
  }
}

async function appendCaptureFailureEvent(
  deps: Required<BaselineCaptureDependencies>,
  sourceFaultRunId: string,
  error: unknown,
): Promise<void> {
  await appendCaptureEvent(deps, sourceFaultRunId, 'BASELINE_CAPTURE_FAILED', {
    failureCode: error instanceof BaselineCaptureError
      ? error.code : 'CONTROL_PLANE_STORAGE_FAILED',
  }).catch(() => undefined);
}

function buildScenarioBaseline(
  sourceFaultRunId: string,
  run: FaultRunRecord,
  facts: FoldedBaselineFacts,
  metadata: BaselineMetadata,
  warmupMetadata: BaselineWarmupMetadata,
  limitations: BaselineLimitation[],
  audit: FaultRunAuditRecord | null,
  operatorAuditId: number | null | undefined,
  baselineId: string,
  deps: Required<BaselineCaptureDependencies>,
): ScenarioBaseline {
  const captureStatus = deriveCaptureStatus(facts.status, limitations);
  const now = deps.now().toISOString();
  const rollbackProcedure = buildRollbackProcedure(run.scenario, facts.outcome.resourceCleanup);
  return {
    baselineId,
    scenario: run.scenario,
    sourceFaultRunId,
    captureStatus,
    catalogRevision: metadata.catalogRevision,
    releaseRevision: metadata.releaseRevision,
    deploymentMode: metadata.deploymentMode,
    schemaRevision: BASELINE_SCHEMA_REVISION,
    dataWarmupEnabled: warmupMetadata.dataWarmupEnabled,
    warmupConfig: warmupMetadata.config
      ? {
        windowDays: warmupMetadata.config.windowDays,
        rowsPerDay: warmupMetadata.config.rowsPerDay,
        targetRows: warmupMetadata.config.targetRows,
      }
      : null,
    lifecycle: facts.lifecycle,
    outcome: facts.outcome,
    requestSummary: facts.requestSummary,
    resourceBudget: null,
    resourceObservation: null,
    observationSummary: unknownObservationSummary(),
    alertSummary: unknownAlertSummary(),
    knownLimitations: limitations,
    residualResources: buildResidualResources(run.scenario, facts.outcome.resourceCleanup),
    rollbackProcedure,
    createdByOperatorAuditId: operatorAuditId ?? audit?.id ?? run.operatorAuditId,
    createdAt: now,
    updatedAt: now,
  };
}

function buildRollbackProcedure(
  scenario: FaultRunRecord['scenario'],
  cleanupStatus: ScenarioBaseline['outcome']['resourceCleanup'],
): BaselineRollbackStep[] {
  const steps: BaselineRollbackStep[] = [
    { code: 'STOP_FAULT_RUN', description: `Use the existing Operator recovery path for ${scenario}.` },
  ];
  if (cleanupStatus === 'MANUAL_REQUIRED') {
    steps.push({ code: 'CONFIRM_MANUAL_CLEANUP', description: 'Run the Catalog-approved cleanup endpoint and verify the run-scoped resource.' });
  }
  if (cleanupStatus === 'NOT_REQUIRED') {
    steps.push({ code: 'RETAIN_NON_RELEASING_EFFECT', description: 'Treat the retained effect as non-releasing and follow the service-specific rollback procedure.' });
  }
  return steps;
}

function buildResidualResources(
  scenario: FaultRunRecord['scenario'],
  cleanupStatus: ScenarioBaseline['outcome']['resourceCleanup'],
): BaselineResidualResource[] {
  if (cleanupStatus === 'NOT_REQUIRED') {
    return [{
      resourceType: `${scenario}:non-releasing-effect`,
      status: 'UNKNOWN',
      cleanupStatus: 'NOT_REQUIRED',
      reference: null,
    }];
  }
  if (cleanupStatus === 'MANUAL_REQUIRED' || cleanupStatus === 'UNKNOWN') {
    return [{
      resourceType: `${scenario}:run-scoped-resource`,
      status: 'UNKNOWN',
      cleanupStatus,
      reference: null,
    }];
  }
  return [];
}

function unknownObservationSummary(): BaselineObservationSummary {
  const check = (): BaselineObservationCheck => ({
    status: 'UNKNOWN',
    checkedAt: null,
    windowStart: null,
    windowEnd: null,
    queryReference: null,
    limitation: 'OBSERVATION_UNAVAILABLE',
  });
  return {
    prometheus: check(),
    loki: check(),
    tempo: check(),
    retention: 'UNKNOWN',
  };
}

function unknownAlertSummary(): BaselineAlertSummary {
  return {
    rules: [],
    checkedAt: null,
    status: 'UNKNOWN',
  };
}

function collectLimitations(
  facts: FoldedBaselineFacts,
  metadata: BaselineMetadata,
  warmupMetadata: BaselineWarmupMetadata,
  audit: FaultRunAuditRecord | null,
): BaselineLimitation[] {
  const limitations = [...facts.knownLimitations];
  for (const code of [...metadata.limitations, ...warmupMetadata.limitations]) {
    addLimitation(limitations, code);
  }
  if (!audit) addLimitation(limitations, 'OPERATOR_AUDIT_UNAVAILABLE');
  addLimitation(limitations, 'OBSERVATION_UNAVAILABLE', 'PROMETHEUS_LOKI_TEMPO');
  addLimitation(limitations, 'ALERT_RECEIPT_UNVERIFIED');
  return limitations;
}

function deriveCaptureStatus(
  foldedStatus: FoldedBaselineFacts['status'],
  limitations: readonly BaselineLimitation[],
): ScenarioBaseline['captureStatus'] {
  if (foldedStatus === 'INCOMPLETE') return 'INCOMPLETE';
  return limitations.length > 0 ? 'COMPLETE_WITH_LIMITATIONS' : 'COMPLETE';
}

async function loadCaptureMetadata(
  deps: Required<BaselineCaptureDependencies>,
): Promise<BaselineMetadata> {
  try {
    return deps.loadMetadata();
  } catch (error) {
    throw new BaselineCaptureError(
      'CATALOG_REVISION_FAILED',
      error instanceof Error ? error.message : undefined,
    );
  }
}

async function appendCaptureEvent(
  deps: Required<BaselineCaptureDependencies>,
  faultRunId: string,
  eventType: string,
  payload: unknown = {},
): Promise<void> {
  await deps.appendEvent(
    faultRunId,
    eventType,
    normalizeBaselineCaptureEventPayload(eventType, payload),
  );
}

function addLimitation(
  limitations: BaselineLimitation[],
  code: string,
  detail: string | null = null,
): void {
  if (limitations.some((limitation) => limitation.code === code && limitation.detail === detail)) return;
  limitations.push({ code, detail });
}
