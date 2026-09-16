import type { FaultRunScenario } from './fault-run-catalog';
import { getPool } from './db';

export const BASELINE_SCHEMA_REVISION = 'baseline.v1' as const;

export const BASELINE_CAPTURE_STATUSES = [
  'COMPLETE',
  'COMPLETE_WITH_LIMITATIONS',
  'INCOMPLETE',
  'CAPTURE_FAILED',
] as const;

export type BaselineCaptureStatus = typeof BASELINE_CAPTURE_STATUSES[number];

export const PILOT_REVIEW_DECISIONS = ['CANDIDATE', 'SELECTED', 'REJECTED'] as const;
export type PilotReviewDecision = typeof PILOT_REVIEW_DECISIONS[number];

export const BASELINE_DEPLOYMENT_MODES = ['local', 'compose', 'kubernetes', 'unknown'] as const;
export type BaselineDeploymentMode = typeof BASELINE_DEPLOYMENT_MODES[number];

export const BASELINE_OBSERVATION_STATUSES = [
  'AVAILABLE',
  'PARTIAL',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;
export type BaselineObservationStatus = typeof BASELINE_OBSERVATION_STATUSES[number];

export const BASELINE_RETENTION_STATUSES = [
  'CHECKED',
  'PARTIAL',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;
export type BaselineRetentionStatus = typeof BASELINE_RETENTION_STATUSES[number];

export const BASELINE_FAILURE_CLASSES = [
  'TARGET_EFFECT_FAILURE',
  'CONTROL_PLANE_FAILURE',
  'WORKER_FAILURE',
  'RECOVERY_FAILURE',
  'CLEANUP_FAILURE',
] as const;
export type BaselineFailureClass = typeof BASELINE_FAILURE_CLASSES[number];

export type BaselineFactStatus = 'COMPLETED' | 'FAILED' | 'UNKNOWN';
export type BaselineEffectStatus = 'OBSERVED' | 'NOT_OBSERVED' | 'UNKNOWN';
export type BaselineRecoveryStatus = 'YES' | 'NO' | 'UNKNOWN';
export type BaselineCleanupStatus =
  | 'NOT_REQUIRED'
  | 'AUTOMATIC_COMPLETED'
  | 'MANUAL_REQUIRED'
  | 'COMPLETED'
  | 'FAILED'
  | 'UNKNOWN';

export interface BaselineLifecycle {
  prepareStartedAt: string | null;
  activeAt: string | null;
  stopRequestedAt: string | null;
  recoveredAt: string | null;
  cleanupFinishedAt: string | null;
}

export interface BaselineOutcome {
  controlAction: BaselineFactStatus;
  effectObserved: BaselineEffectStatus;
  businessRecovered: BaselineRecoveryStatus;
  resourceCleanup: BaselineCleanupStatus;
  failureClasses: BaselineFailureClass[];
  failureCodes: string[];
}

export interface BaselineRequestSummary {
  requests: number | null;
  successes: number | null;
  failures: number | null;
  timeouts: number | null;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
}

export interface BaselineWarmupConfig {
  windowDays: number;
  rowsPerDay: number;
  targetRows: number;
}

export interface BaselineObservationCheck {
  status: BaselineObservationStatus;
  checkedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  queryReference: string | null;
  limitation: string | null;
}

export interface BaselineObservationSummary {
  prometheus: BaselineObservationCheck;
  loki: BaselineObservationCheck;
  tempo: BaselineObservationCheck;
  retention: BaselineRetentionStatus;
}

export interface BaselineAlertRule {
  name: string;
  threshold: string | null;
  duration: string | null;
  declared: boolean | null;
  observed: BaselineObservationStatus;
}

export interface BaselineAlertSummary {
  rules: BaselineAlertRule[];
  checkedAt: string | null;
  status: BaselineObservationStatus;
}

export interface BaselineLimitation {
  code: string;
  detail: string | null;
}

export interface BaselineResidualResource {
  resourceType: string;
  status: 'PRESENT' | 'ABSENT' | 'UNKNOWN';
  cleanupStatus: BaselineCleanupStatus;
  reference: string | null;
}

export interface BaselineRollbackStep {
  code: string;
  description: string;
}

export interface ScenarioBaseline {
  baselineId: string;
  scenario: FaultRunScenario;
  sourceFaultRunId: string;
  captureStatus: BaselineCaptureStatus;
  catalogRevision: string;
  releaseRevision: string | null;
  deploymentMode: BaselineDeploymentMode;
  schemaRevision: typeof BASELINE_SCHEMA_REVISION;
  dataWarmupEnabled: boolean | null;
  warmupConfig: BaselineWarmupConfig | null;
  lifecycle: BaselineLifecycle;
  outcome: BaselineOutcome;
  requestSummary: BaselineRequestSummary | null;
  resourceBudget: Record<string, string | number | boolean | null> | null;
  resourceObservation: Record<string, string | number | boolean | null> | null;
  observationSummary: BaselineObservationSummary;
  alertSummary: BaselineAlertSummary;
  knownLimitations: BaselineLimitation[];
  residualResources: BaselineResidualResource[];
  rollbackProcedure: BaselineRollbackStep[];
  createdByOperatorAuditId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BaselinePilotReview {
  reviewId: number;
  scenario: FaultRunScenario;
  catalogRevision: string;
  decision: PilotReviewDecision;
  alertRules: BaselineAlertRule[];
  evidenceRequirements: BaselineLimitation[];
  retentionSnapshot: Record<string, string | number | boolean | null>;
  remediationBoundary: string;
  decisionReason: string;
  operatorAuditId: number;
  reviewedAt: string;
}

export const BASELINE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS scenario_baselines (
    baseline_id                  CHAR(36)     NOT NULL PRIMARY KEY,
    scenario                     VARCHAR(64)  NOT NULL,
    source_fault_run_id          CHAR(36)     NOT NULL,
    capture_status               VARCHAR(32)  NOT NULL,
    catalog_revision             VARCHAR(128) NOT NULL,
    release_revision             VARCHAR(128) NULL,
    deployment_mode              VARCHAR(32)  NOT NULL,
    schema_revision              VARCHAR(64)  NOT NULL,
    data_warmup_enabled          TINYINT      NULL,
    warmup_config                JSON         NULL,
    lifecycle_json               JSON         NOT NULL,
    outcome_json                 JSON         NOT NULL,
    request_summary_json         JSON         NULL,
    resource_budget_json         JSON         NULL,
    resource_observation_json    JSON         NULL,
    observation_summary_json     JSON         NOT NULL,
    alert_summary_json           JSON         NOT NULL,
    known_limitations            JSON         NOT NULL,
    residual_resources           JSON         NOT NULL,
    rollback_procedure           JSON         NOT NULL,
    created_by_operator_audit_id BIGINT       NULL,
    created_at                   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at                   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_baseline_source_run (source_fault_run_id),
    INDEX idx_baseline_scenario_revision (scenario, catalog_revision, created_at),
    INDEX idx_baseline_status (capture_status, created_at),
    CHECK (capture_status IN ('COMPLETE', 'COMPLETE_WITH_LIMITATIONS', 'INCOMPLETE', 'CAPTURE_FAILED')),
    CHECK (deployment_mode IN ('local', 'compose', 'kubernetes', 'unknown')),
    CHECK (data_warmup_enabled IN (0, 1))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS baseline_pilot_reviews (
    review_id               BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    scenario                VARCHAR(64)  NOT NULL,
    catalog_revision        VARCHAR(128) NOT NULL,
    decision                VARCHAR(16)  NOT NULL,
    alert_rules             JSON         NOT NULL,
    evidence_requirements   JSON         NOT NULL,
    retention_snapshot      JSON         NOT NULL,
    remediation_boundary    TEXT         NOT NULL,
    decision_reason         TEXT         NOT NULL,
    operator_audit_id       BIGINT       NOT NULL,
    reviewed_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_pilot_review (scenario, catalog_revision),
    CHECK (decision IN ('CANDIDATE', 'SELECTED', 'REJECTED'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `ALTER TABLE scenario_baselines
   MODIFY data_warmup_enabled TINYINT NULL`,
] as const;

let baselineSchemaPromise: Promise<void> | null = null;

export function ensureBaselineSchema(): Promise<void> {
  if (!baselineSchemaPromise) {
    baselineSchemaPromise = (async () => {
      const pool = getPool();
      for (const statement of BASELINE_SCHEMA_STATEMENTS) await pool.query(statement);
    })().catch((error) => {
      baselineSchemaPromise = null;
      throw error;
    });
  }
  return baselineSchemaPromise;
}

export function isBaselineCaptureStatus(value: unknown): value is BaselineCaptureStatus {
  return isOneOf(BASELINE_CAPTURE_STATUSES, value);
}

export function isPilotReviewDecision(value: unknown): value is PilotReviewDecision {
  return isOneOf(PILOT_REVIEW_DECISIONS, value);
}

export function isBaselineDeploymentMode(value: unknown): value is BaselineDeploymentMode {
  return isOneOf(BASELINE_DEPLOYMENT_MODES, value);
}

export function isBaselineObservationStatus(value: unknown): value is BaselineObservationStatus {
  return isOneOf(BASELINE_OBSERVATION_STATUSES, value);
}

export function isBaselineFailureClass(value: unknown): value is BaselineFailureClass {
  return isOneOf(BASELINE_FAILURE_CLASSES, value);
}

function isOneOf<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === 'string' && values.includes(value);
}
