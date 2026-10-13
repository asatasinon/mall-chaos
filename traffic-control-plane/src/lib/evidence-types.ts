import { createHash } from 'node:crypto';
import {
  EVIDENCE_OBSERVATION_MODE_VALUES,
  EVIDENCE_PREDICATE_OPERATOR_VALUES,
  EVIDENCE_PROJECTION_VALUES,
  EVIDENCE_SOURCE_VALUES,
  EVIDENCE_TEMPLATE_VALUES,
  EVIDENCE_WINDOW_VALUES,
  SCENARIO_CONTRACT_REVISION_PATTERN,
  isEvidenceContractPlan,
  type EvidenceContractPlan,
  type EvidencePredicate,
  type EvidenceScope,
  type EvidenceSource,
  type EvidenceTemplateId,
  type EvidenceWindow,
} from './scenario-contract';
import { listScenarioDefinitions, type FaultRunScenario } from './fault-run-catalog';
import {
  createEvidenceContractSnapshotRecord,
  deepFreezeEvidenceSnapshotValue,
  serializeEvidenceContractSnapshotRecord,
  type EvidenceContractSnapshotRecord,
} from './evidence-contract-snapshot';

export const EVIDENCE_MANIFEST_SCHEMA_VERSION = 'evidence-manifest.v1' as const;
export const EVIDENCE_RENDERED_PLAN_SCHEMA_VERSION = 'evidence-rendered-plan.v1' as const;
export const EVIDENCE_RENDERER_REVISION = 'evidence-renderer.v2' as const;
export const EVIDENCE_EVALUATION_REVISION = 'evidence-evaluation.v2' as const;

export const EVIDENCE_STATUSES = [
  'AVAILABLE',
  'PARTIAL',
  'EVIDENCE_UNAVAILABLE',
  'INVALID_QUERY',
] as const;
export type EvidenceStatus = typeof EVIDENCE_STATUSES[number];

export const EVIDENCE_ATTEMPT_STATES = [
  'RUNNING',
  'COMPLETED',
  'EVIDENCE_UNAVAILABLE',
  'FAILED',
] as const;
export type EvidenceAttemptState = typeof EVIDENCE_ATTEMPT_STATES[number];

export const EVIDENCE_ITEM_AVAILABILITIES = [
  'AVAILABLE',
  'NO_DATA',
  'EVIDENCE_UNAVAILABLE',
  'INVALID_QUERY',
  'NOT_APPLICABLE',
] as const;
export type EvidenceItemAvailability = typeof EVIDENCE_ITEM_AVAILABILITIES[number];

export const EVIDENCE_COVERAGE_STATES = ['FULL', 'PARTIAL', 'NONE', 'NOT_APPLICABLE'] as const;
export type EvidenceCoverage = typeof EVIDENCE_COVERAGE_STATES[number];

export const EVIDENCE_PREDICATE_OUTCOMES = ['MET', 'NOT_MET', 'INCONCLUSIVE'] as const;
export type EvidencePredicateOutcome = typeof EVIDENCE_PREDICATE_OUTCOMES[number];

export const EVIDENCE_WINDOW_STATES = ['READY', 'NOT_READY', 'NOT_APPLICABLE'] as const;
export type EvidenceWindowState = typeof EVIDENCE_WINDOW_STATES[number];

export const EVIDENCE_EFFECT_ASSESSMENTS = ['OBSERVED', 'NOT_OBSERVED', 'INCONCLUSIVE'] as const;
export type EvidenceEffectAssessment = typeof EVIDENCE_EFFECT_ASSESSMENTS[number];

export const EVIDENCE_VALUE_UNITS = [
  'ratio',
  'seconds',
  'bytes',
  'bytes_per_second',
  'count',
  'count_per_second',
  'boolean',
  'timeline',
] as const;
export type EvidenceValueUnit = typeof EVIDENCE_VALUE_UNITS[number];

export const EVIDENCE_SCOPE_MODES = ['DECLARED', 'SERVICE_ONLY'] as const;
export type EvidenceScopeMode = typeof EVIDENCE_SCOPE_MODES[number];

export const EVIDENCE_AGGREGATIONS = [
  'ACTIVE_ANY_SAMPLE',
  'RECOVERY_ALL_SAMPLES',
  'BASELINE_SUMMARY',
  'TRACE_MATCH_COUNT',
  'LOKI_BUCKET_SERIES',
  'CURRENT_BOOLEAN',
  'TIMELINE',
] as const;
export type EvidenceAggregation = typeof EVIDENCE_AGGREGATIONS[number];

export interface EvidenceWindowLimits {
  readonly baseline: number;
  readonly active: number;
  readonly recovery: number;
  readonly cleanup: number;
}

function isUniqueEvidenceRecipeList(value: unknown[]): value is RenderedEvidenceRecipe[] {
  if (value.length > 1024 || !value.every(isRenderedEvidenceRecipe)) return false;
  const ids = value.map((recipe) => `${recipe.recipeId}\u0000${recipe.window}`);
  return new Set(ids).size === ids.length;
}

export interface RenderedEvidenceRecipe {
  readonly recipeId: string;
  readonly source: EvidenceSource;
  readonly window: EvidenceWindow;
  readonly observationMode: 'WINDOWED' | 'CURRENT';
  readonly required: boolean;
  readonly template: EvidenceTemplateId;
  readonly scope: EvidenceScope;
  readonly scopeMode: EvidenceScopeMode;
  readonly predicate: EvidencePredicate;
  readonly projection: typeof EVIDENCE_PROJECTION_VALUES[number];
  readonly renderedQuery: string | null;
  readonly businessCheckId: 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT' | null;
  readonly valueUnit: EvidenceValueUnit;
  readonly lookbackSec: number;
  readonly aggregation: EvidenceAggregation;
  readonly baselineForRecipeId: string | null;
}

export interface EvidenceRenderedPlan {
  readonly schemaVersion: typeof EVIDENCE_RENDERED_PLAN_SCHEMA_VERSION;
  readonly rendererRevision: string;
  readonly evaluationRevision: string;
  readonly windowLimits: EvidenceWindowLimits;
  readonly recipes: readonly RenderedEvidenceRecipe[];
}

export interface EvidenceCaptureSnapshotRecord extends EvidenceContractSnapshotRecord {
  readonly renderedPlanHash: string;
  readonly renderedPlan: EvidenceRenderedPlan;
}

export interface EvidenceStoredContractSnapshotRecord extends EvidenceCaptureSnapshotRecord {
  readonly snapshotId: string;
  readonly sourceFaultRunId: string;
  readonly scenario: FaultRunScenario;
  readonly contractSchemaVersion: 'evidence-contract.v1';
  readonly createdAt: string;
}

export interface SerializedEvidenceCaptureSnapshot {
  readonly contractRevision: string;
  readonly contractHash: string;
  readonly contractJson: string;
  readonly rendererRevision: string;
  readonly evaluationRevision: string;
  readonly renderedPlanHash: string;
  readonly renderedPlanJson: string;
}

export type EvidenceTypeErrorCode =
  | 'EVIDENCE_JSON_INVALID'
  | 'EVIDENCE_CONTRACT_SNAPSHOT_INVALID'
  | 'EVIDENCE_RENDERED_PLAN_INVALID'
  | 'EVIDENCE_RENDERED_PLAN_HASH_MISMATCH'
  | 'EVIDENCE_MANIFEST_INVALID'
  | 'EVIDENCE_MANIFEST_METADATA_INVALID'
  | 'EVIDENCE_MANIFEST_TIMELINE_INVALID'
  | 'EVIDENCE_MANIFEST_WINDOWS_INVALID'
  | 'EVIDENCE_MANIFEST_RECIPES_INVALID'
  | 'EVIDENCE_MANIFEST_LIMITATIONS_INVALID'
  | 'EVIDENCE_ATTEMPT_INVALID'
  | 'EVIDENCE_ATTEMPT_ITEM_INVALID'
  | 'EVIDENCE_NOTE_INVALID';

export class EvidenceTypeError extends Error {
  constructor(readonly code: EvidenceTypeErrorCode) {
    super(code);
    this.name = 'EvidenceTypeError';
  }
}

export interface EvidenceTimeline {
  readonly createdAt: string;
  readonly prepareStartedAt: string | null;
  readonly activeAt: string | null;
  readonly stopRequestedAt: string | null;
  readonly recoveryStartedAt: string | null;
  readonly recoveredAt: string | null;
  readonly cleanupFinishedAt: string | null;
  readonly terminalAt: string | null;
  readonly terminalState: 'RECOVERED' | 'STOPPED' | 'FAILED' | 'SERVICE_UNAVAILABLE' | null;
}

export interface EvidenceResolvedWindow {
  readonly name: EvidenceWindow;
  readonly state: EvidenceWindowState;
  readonly canonicalStartAt: string | null;
  readonly canonicalEndAt: string | null;
  readonly reasonCode: string | null;
}

export interface EvidenceLimitation {
  readonly code: string;
  readonly window: EvidenceWindow | null;
}

export interface EvidenceManifestCore {
  readonly manifestSchemaVersion: typeof EVIDENCE_MANIFEST_SCHEMA_VERSION;
  readonly manifestId: string;
  readonly snapshotId: string;
  readonly sourceFaultRunId: string;
  readonly scenario: FaultRunScenario;
  readonly contractRevision: string;
  readonly contractHash: string;
  readonly renderedPlanHash: string;
  readonly manifestRevision: number;
  readonly timelineHash: string;
  readonly manifestHash: string;
  readonly timeline: EvidenceTimeline;
  readonly windows: readonly EvidenceResolvedWindow[];
  readonly recipes: readonly RenderedEvidenceRecipe[];
  readonly limitations: readonly EvidenceLimitation[];
  readonly materializedAt: string;
}

export type EvidenceManifestDraft = Omit<
  EvidenceManifestCore,
  'manifestId' | 'manifestRevision' | 'manifestHash' | 'materializedAt'
>;

export interface EvidenceManifestRecord extends EvidenceManifestCore {
  readonly sourceRunRetained: boolean;
}

export interface EvidenceAttemptRecord {
  readonly attemptId: string;
  readonly manifestId: string;
  readonly sourceFaultRunId: string;
  readonly requestHash: string;
  readonly state: EvidenceAttemptState;
  readonly evidenceStatus: EvidenceStatus | null;
  readonly operatorAuditId: number | null;
  readonly requestedAt: string;
  readonly deadlineAt: string;
  readonly completedAt: string | null;
  readonly totalDurationMs: number | null;
  readonly failureCode: string | null;
}

export interface EvidenceAttemptItemRecord {
  readonly recipeId: string;
  readonly source: EvidenceSource;
  readonly window: EvidenceWindow;
  readonly availability: EvidenceItemAvailability;
  readonly coverage: EvidenceCoverage;
  readonly predicateOutcome: EvidencePredicateOutcome;
  readonly reasonCode: string | null;
  readonly durationMs: number | null;
  readonly queriedAt: string | null;
  readonly executedStartAt: string | null;
  readonly executedEndAt: string | null;
}

export interface EvidenceOperatorNoteRecord {
  readonly noteId: string;
  readonly manifestId: string;
  readonly sourceFaultRunId: string;
  readonly requestHash: string;
  readonly operatorAuditId: number;
  readonly text: string;
  readonly createdAt: string;
}

export function parseEvidenceManifestDraft(value: unknown): EvidenceManifestDraft {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      'manifestSchemaVersion', 'snapshotId', 'sourceFaultRunId', 'scenario',
      'contractRevision', 'contractHash', 'renderedPlanHash', 'timelineHash',
      'timeline', 'windows', 'recipes', 'limitations',
    ])
    || value.manifestSchemaVersion !== EVIDENCE_MANIFEST_SCHEMA_VERSION
    || !isUuid(value.snapshotId)
    || !isUuid(value.sourceFaultRunId)
    || !isScenario(value.scenario)
    || typeof value.contractRevision !== 'string'
    || !SCENARIO_CONTRACT_REVISION_PATTERN.test(value.contractRevision)
    || !isSha256(value.contractHash)
    || !isSha256(value.renderedPlanHash)
    || !isSha256(value.timelineHash)
    ) {
    throw new EvidenceTypeError('EVIDENCE_MANIFEST_INVALID');
  }
  if (!isEvidenceTimeline(value.timeline)) throw new EvidenceTypeError('EVIDENCE_MANIFEST_TIMELINE_INVALID');
  if (!isEvidenceWindows(value.windows)) throw new EvidenceTypeError('EVIDENCE_MANIFEST_WINDOWS_INVALID');
  if (!Array.isArray(value.recipes) || !isUniqueEvidenceRecipeList(value.recipes)) {
    throw new EvidenceTypeError('EVIDENCE_MANIFEST_RECIPES_INVALID');
  }
  if (!Array.isArray(value.limitations) || value.limitations.length > 256
    || !value.limitations.every(isEvidenceLimitation)) {
    throw new EvidenceTypeError('EVIDENCE_MANIFEST_LIMITATIONS_INVALID');
  }
  return structuredClone(value) as unknown as EvidenceManifestDraft;
}

export function getEvidenceTimelineHash(timeline: EvidenceTimeline): string {
  if (!isEvidenceTimeline(timeline)) throw new EvidenceTypeError('EVIDENCE_MANIFEST_INVALID');
  return createHash('sha256').update(canonicalJson(timeline), 'utf8').digest('hex');
}

export function getEvidenceManifestHash(draft: EvidenceManifestDraft): string {
  const checked = parseEvidenceManifestDraft(draft);
  return createHash('sha256').update(canonicalJson(checked), 'utf8').digest('hex');
}

export function createEvidenceCaptureSnapshot(
  contractRevision: string,
  evidence: EvidenceContractPlan,
  renderedPlan: EvidenceRenderedPlan,
): EvidenceCaptureSnapshotRecord {
  if (!isEvidenceContractPlan(evidence)) throw new EvidenceTypeError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID');
  if (!isEvidenceRenderedPlan(renderedPlan)) throw new EvidenceTypeError('EVIDENCE_RENDERED_PLAN_INVALID');
  const snapshot = createEvidenceContractSnapshotRecord(contractRevision, evidence);
  return deepFreezeEvidenceSnapshotValue({
    ...snapshot,
    renderedPlan: structuredClone(renderedPlan),
    renderedPlanHash: getEvidenceRenderedPlanHash(renderedPlan),
  });
}

export function serializeEvidenceCaptureSnapshot(
  snapshot: EvidenceCaptureSnapshotRecord,
): SerializedEvidenceCaptureSnapshot {
  if (!isEvidenceContractPlan(snapshot.evidence)) {
    throw new EvidenceTypeError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID');
  }
  if (!isEvidenceRenderedPlan(snapshot.renderedPlan)) {
    throw new EvidenceTypeError('EVIDENCE_RENDERED_PLAN_INVALID');
  }
  const contract = serializeEvidenceContractSnapshotRecord(snapshot);
  const renderedPlanHash = getEvidenceRenderedPlanHash(snapshot.renderedPlan);
  if (!isSha256(snapshot.renderedPlanHash) || snapshot.renderedPlanHash !== renderedPlanHash) {
    throw new EvidenceTypeError('EVIDENCE_RENDERED_PLAN_HASH_MISMATCH');
  }
  return {
    ...contract,
    rendererRevision: snapshot.renderedPlan.rendererRevision,
    evaluationRevision: snapshot.renderedPlan.evaluationRevision,
    renderedPlanHash,
    renderedPlanJson: canonicalizeEvidenceRenderedPlan(snapshot.renderedPlan),
  };
}

export function parseEvidenceCaptureSnapshot(value: unknown): EvidenceCaptureSnapshotRecord {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      'contractRevision',
      'contractHash',
      'contractJson',
      'rendererRevision',
      'evaluationRevision',
      'renderedPlanHash',
      'renderedPlanJson',
    ])
    || typeof value.contractRevision !== 'string'
    || !SCENARIO_CONTRACT_REVISION_PATTERN.test(value.contractRevision)
    || typeof value.contractHash !== 'string'
    || !isSha256(value.contractHash)
    || !(typeof value.contractJson === 'string' || isPlainRecord(value.contractJson) || Array.isArray(value.contractJson))
    || typeof value.rendererRevision !== 'string'
    || typeof value.evaluationRevision !== 'string'
    || typeof value.renderedPlanHash !== 'string'
    || !isSha256(value.renderedPlanHash)
    || typeof value.renderedPlanJson !== 'string') {
    throw new EvidenceTypeError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID');
  }
  const evidence = parseJsonColumn(value.contractJson);
  const renderedPlan = parseJsonColumn(value.renderedPlanJson);
  if (!isEvidenceContractPlan(evidence) || !isEvidenceRenderedPlan(renderedPlan)
    || renderedPlan.rendererRevision !== value.rendererRevision
    || renderedPlan.evaluationRevision !== value.evaluationRevision) {
    throw new EvidenceTypeError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID');
  }
  const snapshot = createEvidenceCaptureSnapshot(value.contractRevision, evidence, renderedPlan);
  if (snapshot.contractHash !== value.contractHash) {
    throw new EvidenceTypeError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID');
  }
  if (snapshot.renderedPlanHash !== value.renderedPlanHash) {
    throw new EvidenceTypeError('EVIDENCE_RENDERED_PLAN_HASH_MISMATCH');
  }
  return snapshot;
}

export function parseEvidenceStoredContractSnapshot(
  value: unknown,
): EvidenceStoredContractSnapshotRecord {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      'snapshotId', 'sourceFaultRunId', 'scenario', 'contractSchemaVersion',
      'contractRevision', 'contractHash', 'evidence', 'rendererRevision',
      'evaluationRevision', 'renderedPlanHash', 'renderedPlan', 'createdAt',
    ])
    || !isUuid(value.snapshotId)
    || !isUuid(value.sourceFaultRunId)
    || !isScenario(value.scenario)
    || value.contractSchemaVersion !== 'evidence-contract.v1'
    || typeof value.contractRevision !== 'string'
    || !isSha256(value.contractHash)
    || !isEvidenceContractPlan(value.evidence)
    || typeof value.rendererRevision !== 'string'
    || typeof value.evaluationRevision !== 'string'
    || !isSha256(value.renderedPlanHash)
    || !isEvidenceRenderedPlan(value.renderedPlan)
    || !isIsoTimestamp(value.createdAt)) {
    throw new EvidenceTypeError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID');
  }
  const capture = createEvidenceCaptureSnapshot(
    value.contractRevision,
    value.evidence,
    value.renderedPlan,
  );
  if (capture.contractHash !== value.contractHash
    || capture.renderedPlanHash !== value.renderedPlanHash
    || capture.renderedPlan.rendererRevision !== value.rendererRevision
    || capture.renderedPlan.evaluationRevision !== value.evaluationRevision) {
    throw new EvidenceTypeError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID');
  }
  return deepFreezeEvidenceSnapshotValue({
    ...capture,
    snapshotId: value.snapshotId,
    sourceFaultRunId: value.sourceFaultRunId,
    scenario: value.scenario,
    contractSchemaVersion: value.contractSchemaVersion,
    createdAt: value.createdAt,
  });
}

export function canonicalizeEvidenceRenderedPlan(plan: EvidenceRenderedPlan): string {
  if (!isEvidenceRenderedPlan(plan)) throw new EvidenceTypeError('EVIDENCE_RENDERED_PLAN_INVALID');
  return canonicalJson({
    ...plan,
    recipes: canonicalEvidenceRecipes(plan.recipes),
  });
}

export function canonicalizeEvidenceRenderedRecipes(
  recipes: readonly RenderedEvidenceRecipe[],
): string {
  if (!isUniqueEvidenceRecipeList([...recipes])) {
    throw new EvidenceTypeError('EVIDENCE_RENDERED_PLAN_INVALID');
  }
  return canonicalJson(canonicalEvidenceRecipes(recipes));
}

export function getEvidenceRenderedPlanHash(plan: EvidenceRenderedPlan): string {
  return createHash('sha256').update(canonicalizeEvidenceRenderedPlan(plan), 'utf8').digest('hex');
}

export function isEvidenceRenderedPlan(value: unknown): value is EvidenceRenderedPlan {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['schemaVersion', 'rendererRevision', 'evaluationRevision', 'windowLimits', 'recipes'])
    || value.schemaVersion !== EVIDENCE_RENDERED_PLAN_SCHEMA_VERSION
    || value.rendererRevision !== EVIDENCE_RENDERER_REVISION
    || value.evaluationRevision !== EVIDENCE_EVALUATION_REVISION
    || !isEvidenceWindowLimits(value.windowLimits)
    || !Array.isArray(value.recipes)
    || value.recipes.length < 1
    || value.recipes.length > 1024
    || !value.recipes.every(isRenderedEvidenceRecipe)) {
    return false;
  }

  function isEvidenceWindowLimits(value: unknown): value is EvidenceWindowLimits {
    return isPlainRecord(value)
      && hasExactKeys(value, EVIDENCE_WINDOW_VALUES)
      && EVIDENCE_WINDOW_VALUES.every((window) => isInteger(value[window], 1, 86_400));
  }
  const ids = value.recipes.map((recipe) => `${recipe.recipeId}\u0000${recipe.window}`);
  return new Set(ids).size === ids.length;
}

export function parseEvidenceManifest(value: unknown): EvidenceManifestRecord {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      'manifestSchemaVersion', 'manifestId', 'snapshotId', 'sourceFaultRunId', 'scenario',
      'contractRevision', 'contractHash', 'renderedPlanHash', 'manifestRevision',
      'timelineHash', 'manifestHash', 'timeline', 'windows', 'recipes', 'limitations',
      'sourceRunRetained', 'materializedAt',
    ])) {
    throw new EvidenceTypeError('EVIDENCE_MANIFEST_INVALID');
  }
  if (value.manifestSchemaVersion !== EVIDENCE_MANIFEST_SCHEMA_VERSION
    || !isUuid(value.manifestId)
    || !isUuid(value.snapshotId)
    || !isUuid(value.sourceFaultRunId)
    || !isScenario(value.scenario)
    || typeof value.contractRevision !== 'string'
    || !SCENARIO_CONTRACT_REVISION_PATTERN.test(value.contractRevision)
    || !isSha256(value.contractHash)
    || !isSha256(value.renderedPlanHash)
    || !isInteger(value.manifestRevision, 1, 0xffff_ffff)
    || !isSha256(value.timelineHash)
    || !isSha256(value.manifestHash)
    || typeof value.sourceRunRetained !== 'boolean'
    || !isIsoTimestamp(value.materializedAt)) {
    throw new EvidenceTypeError('EVIDENCE_MANIFEST_METADATA_INVALID');
  }
  if (!isEvidenceTimeline(value.timeline)) throw new EvidenceTypeError('EVIDENCE_MANIFEST_TIMELINE_INVALID');
  if (!isEvidenceWindows(value.windows)) throw new EvidenceTypeError('EVIDENCE_MANIFEST_WINDOWS_INVALID');
  if (!Array.isArray(value.recipes) || !isUniqueEvidenceRecipeList(value.recipes)) {
    throw new EvidenceTypeError('EVIDENCE_MANIFEST_RECIPES_INVALID');
  }
  if (!Array.isArray(value.limitations) || value.limitations.length > 256
    || !value.limitations.every(isEvidenceLimitation)) {
    throw new EvidenceTypeError('EVIDENCE_MANIFEST_LIMITATIONS_INVALID');
  }
  const draft = parseEvidenceManifestDraft({
    manifestSchemaVersion: value.manifestSchemaVersion,
    snapshotId: value.snapshotId,
    sourceFaultRunId: value.sourceFaultRunId,
    scenario: value.scenario,
    contractRevision: value.contractRevision,
    contractHash: value.contractHash,
    renderedPlanHash: value.renderedPlanHash,
    timelineHash: value.timelineHash,
    timeline: value.timeline,
    windows: value.windows,
    recipes: value.recipes,
    limitations: value.limitations,
  });
  if (getEvidenceTimelineHash(draft.timeline) !== draft.timelineHash
    || getEvidenceManifestHash(draft) !== value.manifestHash) {
    throw new EvidenceTypeError('EVIDENCE_MANIFEST_INVALID');
  }
  return structuredClone(value) as unknown as EvidenceManifestRecord;
}

export function parseEvidenceAttempt(value: unknown): EvidenceAttemptRecord {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      'attemptId', 'manifestId', 'sourceFaultRunId', 'requestHash', 'state',
      'evidenceStatus', 'operatorAuditId', 'requestedAt', 'deadlineAt',
      'completedAt', 'totalDurationMs', 'failureCode',
    ])
    || !isUuid(value.attemptId)
    || !isUuid(value.manifestId)
    || !isUuid(value.sourceFaultRunId)
    || !isSha256(value.requestHash)
    || !includes(EVIDENCE_ATTEMPT_STATES, value.state)
    || !(value.evidenceStatus === null || includes(EVIDENCE_STATUSES, value.evidenceStatus))
    || !(value.operatorAuditId === null || isInteger(value.operatorAuditId, 1, Number.MAX_SAFE_INTEGER))
    || !isIsoTimestamp(value.requestedAt)
    || !isIsoTimestamp(value.deadlineAt)
    || !(value.completedAt === null || isIsoTimestamp(value.completedAt))
    || !(value.totalDurationMs === null || isInteger(value.totalDurationMs, 0, 0xffff_ffff))
    || !(value.failureCode === null || isSafeCode(value.failureCode))
    || !isAttemptLifecycleConsistent(value)) {
    throw new EvidenceTypeError('EVIDENCE_ATTEMPT_INVALID');
  }
  return structuredClone(value) as unknown as EvidenceAttemptRecord;
}

export function parseEvidenceAttemptItem(value: unknown): EvidenceAttemptItemRecord {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      'recipeId', 'source', 'window', 'availability', 'coverage', 'predicateOutcome',
      'reasonCode', 'durationMs', 'queriedAt', 'executedStartAt', 'executedEndAt',
    ])
    || !isRecipeId(value.recipeId)
    || !includes(EVIDENCE_SOURCE_VALUES, value.source)
    || !includes(EVIDENCE_WINDOW_VALUES, value.window)
    || !includes(EVIDENCE_ITEM_AVAILABILITIES, value.availability)
    || !includes(EVIDENCE_COVERAGE_STATES, value.coverage)
    || !includes(EVIDENCE_PREDICATE_OUTCOMES, value.predicateOutcome)
    || !(value.reasonCode === null || isSafeCode(value.reasonCode))
    || !(value.durationMs === null || isInteger(value.durationMs, 0, 0xffff_ffff))
    || !(value.queriedAt === null || isIsoTimestamp(value.queriedAt))
    || !(value.executedStartAt === null || isIsoTimestamp(value.executedStartAt))
    || !(value.executedEndAt === null || isIsoTimestamp(value.executedEndAt))) {
    throw new EvidenceTypeError('EVIDENCE_ATTEMPT_ITEM_INVALID');
  }
  return structuredClone(value) as unknown as EvidenceAttemptItemRecord;
}

export function parseEvidenceOperatorNote(value: unknown): EvidenceOperatorNoteRecord {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      'noteId', 'manifestId', 'sourceFaultRunId', 'requestHash',
      'operatorAuditId', 'text', 'createdAt',
    ])
    || !isUuid(value.noteId)
    || !isUuid(value.manifestId)
    || !isUuid(value.sourceFaultRunId)
    || !isSha256(value.requestHash)
    || !isInteger(value.operatorAuditId, 1, Number.MAX_SAFE_INTEGER)
    || typeof value.text !== 'string'
    || value.text.trim().length === 0
    || Buffer.byteLength(value.text, 'utf8') > 2048
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.text)
    || !isIsoTimestamp(value.createdAt)) {
    throw new EvidenceTypeError('EVIDENCE_NOTE_INVALID');
  }
  return structuredClone(value) as unknown as EvidenceOperatorNoteRecord;
}

export function parseEvidenceJsonColumn(value: unknown): unknown {
  return parseJsonColumn(value);
}

export function parseEvidenceSqlTimestamp(value: unknown): string {
  let timestamp = '';
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) timestamp = value.toISOString();
  } else if (typeof value === 'string') {
    const parsed = new Date(value.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:\d{2}$/u.test(value) ? '' : 'Z'));
    if (!Number.isNaN(parsed.getTime())) timestamp = parsed.toISOString();
  }
  if (!isIsoTimestamp(timestamp)) throw new EvidenceTypeError('EVIDENCE_JSON_INVALID');
  return timestamp;
}

function isRenderedEvidenceRecipe(value: unknown): value is RenderedEvidenceRecipe {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      'recipeId', 'source', 'window', 'observationMode', 'required', 'template',
      'scope', 'scopeMode', 'predicate', 'projection', 'renderedQuery', 'businessCheckId',
      'valueUnit', 'lookbackSec', 'aggregation', 'baselineForRecipeId',
    ])
    || !isRecipeId(value.recipeId)
    || !includes(EVIDENCE_SOURCE_VALUES, value.source)
    || !includes(EVIDENCE_WINDOW_VALUES, value.window)
    || !includes(EVIDENCE_OBSERVATION_MODE_VALUES, value.observationMode)
    || typeof value.required !== 'boolean'
    || !includes(EVIDENCE_TEMPLATE_VALUES, value.template)
    || !isEvidenceScope(value.scope)
    || !includes(EVIDENCE_SCOPE_MODES, value.scopeMode)
    || !isEvidencePredicate(value.predicate)
    || !includes(EVIDENCE_PROJECTION_VALUES, value.projection)
    || !(value.renderedQuery === null || isRenderedQuery(value.renderedQuery))
    || !(value.businessCheckId === null
      || value.businessCheckId === 'CATALOG_PRODUCT_LIST'
      || value.businessCheckId === 'CATALOG_BROWSE_REPORT')
    || !includes(EVIDENCE_VALUE_UNITS, value.valueUnit)
    || !isInteger(value.lookbackSec, 0, 86_400)
    || !includes(EVIDENCE_AGGREGATIONS, value.aggregation)
    || !(value.baselineForRecipeId === null || isRecipeId(value.baselineForRecipeId))) {
    return false;
  }
  if ((value.window === 'baseline'
      && (value.required || value.baselineForRecipeId !== value.recipeId || value.predicate.kind !== 'NONE'))
    || (value.window !== 'baseline' && value.baselineForRecipeId !== null)) {
    return false;
  }

  if (value.source === 'RUN_EVENT') {
    return value.template === 'RUN_TIMELINE'
      && value.scopeMode === 'DECLARED'
      && value.renderedQuery === null
      && value.businessCheckId === null
      && value.aggregation === 'TIMELINE'
      && value.observationMode === 'WINDOWED';
  }
  if (value.source === 'BUSINESS_CHECK') {
    return value.observationMode === 'CURRENT'
      && value.scopeMode === 'DECLARED'
      && (value.template === 'CATALOG_PRODUCT_LIST' || value.template === 'CATALOG_BROWSE_REPORT')
      && value.businessCheckId === value.template
      && value.renderedQuery === null
      && value.aggregation === 'CURRENT_BOOLEAN'
      && value.valueUnit === 'boolean';
  }
  if (value.businessCheckId !== null || value.observationMode !== 'WINDOWED' || value.renderedQuery === null) {
    return false;
  }
  if (value.source === 'PROMETHEUS') {
    return value.scopeMode === 'DECLARED'
      && !['SERVICE_EVENT_COUNT', 'SERVICE_ERROR_COUNT', 'SERVICE_REQUESTS',
      'SERVICE_ERRORS', 'SERVICE_SLOW_REQUESTS', 'SERVICE_ROUTE_REQUESTS',
      'CATALOG_PRODUCT_LIST', 'CATALOG_BROWSE_REPORT', 'RUN_TIMELINE'].includes(value.template)
      && ((value.window === 'baseline' && value.aggregation === 'BASELINE_SUMMARY')
        || (value.window === 'active' && value.aggregation === 'ACTIVE_ANY_SAMPLE')
        || (value.window === 'recovery' && value.aggregation === 'RECOVERY_ALL_SAMPLES')
        || (value.window === 'cleanup' && value.aggregation === 'RECOVERY_ALL_SAMPLES'));
  }
  if (value.source === 'LOKI') {
    return value.scopeMode === 'SERVICE_ONLY'
      && (value.template === 'SERVICE_EVENT_COUNT' || value.template === 'SERVICE_ERROR_COUNT')
      && ((value.window === 'baseline' && value.aggregation === 'BASELINE_SUMMARY')
        || (value.window !== 'baseline' && value.aggregation === 'LOKI_BUCKET_SERIES'));
  }
  if (value.source === 'TEMPO') {
    return value.scopeMode === (value.scope.fixedLabels === undefined ? 'DECLARED' : 'SERVICE_ONLY')
      && ['SERVICE_REQUESTS', 'SERVICE_ERRORS', 'SERVICE_SLOW_REQUESTS', 'SERVICE_ROUTE_REQUESTS']
      .includes(value.template)
      && ((value.window === 'baseline' && value.aggregation === 'BASELINE_SUMMARY')
        || (value.window !== 'baseline' && value.aggregation === 'TRACE_MATCH_COUNT'));
  }
  return false;
}

function canonicalEvidenceRecipes(
  recipes: readonly RenderedEvidenceRecipe[],
): RenderedEvidenceRecipe[] {
  return [...recipes].sort((left, right) =>
    compareText(`${left.recipeId}\u0000${left.window}`, `${right.recipeId}\u0000${right.window}`));
}

function isAttemptLifecycleConsistent(value: Record<string, unknown>): boolean {
  const requestedAt = timestampMilliseconds(value.requestedAt);
  const deadlineAt = timestampMilliseconds(value.deadlineAt);
  const completedAt = value.completedAt === null ? null : timestampMilliseconds(value.completedAt);
  if (requestedAt === null || deadlineAt === null || deadlineAt <= requestedAt
    || (completedAt !== null && completedAt < requestedAt)
    || (completedAt !== null && completedAt > deadlineAt
      && !(value.state === 'FAILED' && value.failureCode === 'EXECUTION_INTERRUPTED'))) return false;

  if (value.state === 'RUNNING') {
    return value.evidenceStatus === null
      && value.completedAt === null
      && value.totalDurationMs === null
      && value.failureCode === null;
  }
  if (completedAt === null || value.totalDurationMs === null) return false;
  if (value.state === 'COMPLETED') {
    return (value.evidenceStatus === 'AVAILABLE' || value.evidenceStatus === 'PARTIAL'
      || value.evidenceStatus === 'INVALID_QUERY')
      && value.failureCode === null;
  }
  if (value.state === 'EVIDENCE_UNAVAILABLE') {
    return value.evidenceStatus === 'EVIDENCE_UNAVAILABLE'
      && value.failureCode === null;
  }
  return value.state === 'FAILED'
    && value.evidenceStatus === null
    && value.failureCode !== null;
}

function isEvidencePredicate(value: unknown): value is EvidencePredicate {
  if (!isPlainRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'NONE') return hasExactKeys(value, ['kind']);
  if (value.kind === 'BOOLEAN_EQUALS') {
    return hasExactKeys(value, ['kind', 'expected']) && typeof value.expected === 'boolean';
  }
  return value.kind === 'COMPARISON'
    && hasExactKeys(value, ['kind', 'operator', 'value'])
    && includes(EVIDENCE_PREDICATE_OPERATOR_VALUES, value.operator)
    && typeof value.value === 'number'
    && Number.isFinite(value.value);
}

function isEvidenceScope(value: unknown): value is EvidenceScope {
  if (!isPlainRecord(value)
    || !Object.keys(value).every((key) => key === 'service' || key === 'route' || key === 'fixedLabels')
    || typeof value.service !== 'string'
    || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.service)) return false;
  if (value.route !== undefined
    && (typeof value.route !== 'string' || value.route.length > 256
      || /[\u0000-\u001f\u007f]/u.test(value.route))) return false;
  if (value.fixedLabels !== undefined) {
    if (!isPlainRecord(value.fixedLabels) || Object.keys(value.fixedLabels).length > 16) return false;
    if (Object.entries(value.fixedLabels).some(([key, label]) =>
      !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/u.test(key)
      || typeof label !== 'string'
      || label.length > 256
      || /[\u0000-\u001f\u007f]/u.test(label))) return false;
  }
  return true;
}

function isEvidenceTimeline(value: unknown): value is EvidenceTimeline {
  return isPlainRecord(value)
    && hasExactKeys(value, [
      'createdAt', 'prepareStartedAt', 'activeAt', 'stopRequestedAt',
      'recoveryStartedAt', 'recoveredAt', 'cleanupFinishedAt', 'terminalAt', 'terminalState',
    ])
    && isIsoTimestamp(value.createdAt)
    && nullableTimestamp(value.prepareStartedAt)
    && nullableTimestamp(value.activeAt)
    && nullableTimestamp(value.stopRequestedAt)
    && nullableTimestamp(value.recoveryStartedAt)
    && nullableTimestamp(value.recoveredAt)
    && nullableTimestamp(value.cleanupFinishedAt)
    && nullableTimestamp(value.terminalAt)
    && (value.terminalState === null
      || ['RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].includes(String(value.terminalState)));
}

function isEvidenceWindows(value: unknown): value is readonly EvidenceResolvedWindow[] {
  if (!Array.isArray(value) || value.length !== EVIDENCE_WINDOW_VALUES.length
    || !value.every(isEvidenceResolvedWindow)) return false;
  return new Set(value.map((window) => window.name)).size === EVIDENCE_WINDOW_VALUES.length
    && EVIDENCE_WINDOW_VALUES.every((name) => value.some((window) => window.name === name));
}

function isEvidenceResolvedWindow(value: unknown): value is EvidenceResolvedWindow {
  return isPlainRecord(value)
    && hasExactKeys(value, ['name', 'state', 'canonicalStartAt', 'canonicalEndAt', 'reasonCode'])
    && includes(EVIDENCE_WINDOW_VALUES, value.name)
    && includes(EVIDENCE_WINDOW_STATES, value.state)
    && nullableTimestamp(value.canonicalStartAt)
    && nullableTimestamp(value.canonicalEndAt)
    && (value.reasonCode === null || isSafeCode(value.reasonCode))
    && ((value.state === 'READY' && value.canonicalStartAt !== null && value.canonicalEndAt !== null
      && value.reasonCode === null)
      || (value.state !== 'READY' && value.canonicalStartAt === null && value.canonicalEndAt === null
        && value.reasonCode !== null));
}

function isEvidenceLimitation(value: unknown): value is EvidenceLimitation {
  return isPlainRecord(value)
    && hasExactKeys(value, ['code', 'window'])
    && isSafeCode(value.code)
    && (value.window === null || includes(EVIDENCE_WINDOW_VALUES, value.window));
}

function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new EvidenceTypeError('EVIDENCE_JSON_INVALID');
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort(compareText);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function timestampMilliseconds(value: unknown): number | null {
  return isIsoTimestamp(value) ? Date.parse(value) : null;
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isSafeCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value);
}

function isRecipeId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128
    && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value);
}

function isRenderedQuery(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum;
}

function isScenario(value: unknown): value is FaultRunScenario {
  return typeof value === 'string' && listScenarioDefinitions().some(({ scenario }) => scenario === value);
}

function includes<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === 'string' && values.includes(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
