import {
  ensureBaselineSchema,
  type BaselineAlertRule,
  type BaselineCaptureStatus,
  type BaselineLimitation,
  type BaselinePilotReview,
  type PilotReviewDecision,
  type ScenarioBaseline,
} from './baseline-schema';
import { getPool } from './db';
import type { FaultRunScenario } from './fault-run-catalog';

export interface BaselineListFilters {
  scenario?: FaultRunScenario;
  captureStatus?: BaselineCaptureStatus;
  catalogRevision?: string;
  limit?: number;
}

export interface PilotReviewListFilters {
  scenario?: FaultRunScenario;
  catalogRevision?: string;
  decision?: PilotReviewDecision;
  limit?: number;
}

export interface SaveBaselinePilotReviewInput {
  scenario: FaultRunScenario;
  catalogRevision: string;
  decision: PilotReviewDecision;
  alertRules: BaselineAlertRule[];
  evidenceRequirements: BaselineLimitation[];
  retentionSnapshot: Record<string, string | number | boolean | null>;
  remediationBoundary: string;
  decisionReason: string;
  operatorAuditId: number;
}

export interface BaselineRepository {
  findBySourceFaultRunId(sourceFaultRunId: string): Promise<ScenarioBaseline | null>;
  save(baseline: ScenarioBaseline): Promise<{ baseline: ScenarioBaseline; created: boolean }>;
}

export interface BaselineQueryRepository extends BaselineRepository {
  list(filters?: BaselineListFilters): Promise<ScenarioBaseline[]>;
  attachOperatorAudit(baselineId: string, operatorAuditId: number): Promise<ScenarioBaseline>;
  listPilotReviews(filters?: PilotReviewListFilters): Promise<BaselinePilotReview[]>;
  savePilotReview(input: SaveBaselinePilotReviewInput): Promise<{
    review: BaselinePilotReview;
    created: boolean;
  }>;
}

export interface BaselineCaptureLock {
  withSourceFaultRunLock<T>(sourceFaultRunId: string, action: () => Promise<T>): Promise<T>;
}

export class SqlBaselineRepository implements BaselineQueryRepository, BaselineCaptureLock {
  async findBySourceFaultRunId(sourceFaultRunId: string): Promise<ScenarioBaseline | null> {
    return loadScenarioBaselineBySourceFaultRunId(sourceFaultRunId);
  }

  async save(baseline: ScenarioBaseline): Promise<{ baseline: ScenarioBaseline; created: boolean }> {
    await ensureBaselineSchema();
    const existing = await loadScenarioBaselineBySourceFaultRunId(baseline.sourceFaultRunId);
    if (existing) return { baseline: existing, created: false };

    try {
      await getPool().execute(
        `INSERT INTO scenario_baselines
          (baseline_id, scenario, source_fault_run_id, capture_status, catalog_revision,
           release_revision, deployment_mode, schema_revision, data_warmup_enabled,
           warmup_config, lifecycle_json, outcome_json, request_summary_json,
           resource_budget_json, resource_observation_json, observation_summary_json,
           alert_summary_json, known_limitations, residual_resources, rollback_procedure,
           created_by_operator_audit_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          baseline.baselineId,
          baseline.scenario,
          baseline.sourceFaultRunId,
          baseline.captureStatus,
          baseline.catalogRevision,
          baseline.releaseRevision,
          baseline.deploymentMode,
          baseline.schemaRevision,
          baseline.dataWarmupEnabled,
          jsonOrNull(baseline.warmupConfig),
          JSON.stringify(baseline.lifecycle),
          JSON.stringify(baseline.outcome),
          jsonOrNull(baseline.requestSummary),
          jsonOrNull(baseline.resourceBudget),
          jsonOrNull(baseline.resourceObservation),
          JSON.stringify(baseline.observationSummary),
          JSON.stringify(baseline.alertSummary),
          JSON.stringify(baseline.knownLimitations),
          JSON.stringify(baseline.residualResources),
          JSON.stringify(baseline.rollbackProcedure),
          baseline.createdByOperatorAuditId,
        ],
      );
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const concurrent = await loadScenarioBaselineBySourceFaultRunId(baseline.sourceFaultRunId);
      if (!concurrent) throw error;
      return { baseline: concurrent, created: false };
    }

    const created = await loadScenarioBaselineBySourceFaultRunId(baseline.sourceFaultRunId);
    if (!created) throw new Error('BASELINE_CREATE_READBACK_FAILED');
    return { baseline: created, created: true };
  }

  async list(filters: BaselineListFilters = {}): Promise<ScenarioBaseline[]> {
    return listScenarioBaselines(filters);
  }

  async attachOperatorAudit(baselineId: string, operatorAuditId: number): Promise<ScenarioBaseline> {
    await ensureBaselineSchema();
    const [result] = await getPool().execute(
      'UPDATE scenario_baselines SET created_by_operator_audit_id = ? WHERE baseline_id = ?',
      [operatorAuditId, baselineId],
    );
    if (Number((result as { affectedRows?: number }).affectedRows ?? 0) < 1) {
      const existing = await loadScenarioBaselineById(baselineId);
      if (!existing) throw new Error('BASELINE_NOT_FOUND');
    }
    const updated = await loadScenarioBaselineById(baselineId);
    if (!updated) throw new Error('BASELINE_AUDIT_READBACK_FAILED');
    return updated;
  }

  async listPilotReviews(filters: PilotReviewListFilters = {}): Promise<BaselinePilotReview[]> {
    return listBaselinePilotReviews(filters);
  }

  async savePilotReview(input: SaveBaselinePilotReviewInput): Promise<{
    review: BaselinePilotReview;
    created: boolean;
  }> {
    await ensureBaselineSchema();
    const connection = await getPool().getConnection();
    const lockName = 'castrel:pilot-selection';
    try {
      const [lockRows] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
      if (Number(asRecordArray(lockRows)[0]?.acquired) !== 1) {
        throw new Error('PILOT_REVIEW_LOCK_TIMEOUT');
      }
      await connection.beginTransaction();
      const [existingRows] = await connection.query(
        'SELECT review_id FROM baseline_pilot_reviews WHERE scenario = ? AND catalog_revision = ? FOR UPDATE',
        [input.scenario, input.catalogRevision],
      );
      const existing = asRecordArray(existingRows)[0];
      if (input.decision === 'SELECTED') {
        const [selectedRows] = await connection.query(
          `SELECT scenario, catalog_revision FROM baseline_pilot_reviews
           WHERE decision = 'SELECTED'
           LIMIT 1 FOR UPDATE`,
        );
        const selectedReview = asRecordArray(selectedRows)[0];
        if (selectedReview
            && (selectedReview.scenario !== input.scenario
              || selectedReview.catalog_revision !== input.catalogRevision)) {
          throw new Error('PILOT_ALREADY_SELECTED');
        }
      }
      await connection.execute(
        `INSERT INTO baseline_pilot_reviews
          (scenario, catalog_revision, decision, alert_rules, evidence_requirements,
           retention_snapshot, remediation_boundary, decision_reason, operator_audit_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           decision = VALUES(decision),
           alert_rules = VALUES(alert_rules),
           evidence_requirements = VALUES(evidence_requirements),
           retention_snapshot = VALUES(retention_snapshot),
           remediation_boundary = VALUES(remediation_boundary),
           decision_reason = VALUES(decision_reason),
           operator_audit_id = VALUES(operator_audit_id),
           reviewed_at = CURRENT_TIMESTAMP(3)`,
        [
          input.scenario,
          input.catalogRevision,
          input.decision,
          JSON.stringify(input.alertRules),
          JSON.stringify(input.evidenceRequirements),
          JSON.stringify(input.retentionSnapshot),
          input.remediationBoundary,
          input.decisionReason,
          input.operatorAuditId,
        ],
      );
      const [reviewRows] = await connection.query(
        'SELECT * FROM baseline_pilot_reviews WHERE scenario = ? AND catalog_revision = ?',
        [input.scenario, input.catalogRevision],
      );
      const reviewRow = asRecordArray(reviewRows)[0];
      if (!reviewRow) throw new Error('PILOT_REVIEW_READBACK_FAILED');
      await connection.commit();
      return {
        review: toBaselinePilotReview(reviewRow),
        created: !existing,
      };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } finally {
        connection.release();
      }
    }
  }

  async withSourceFaultRunLock<T>(
    sourceFaultRunId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const connection = await getPool().getConnection();
    const lockName = `castrel:baseline:${sourceFaultRunId}`;
    try {
      const [rows] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
      if (Number(asRecordArray(rows)[0]?.acquired) !== 1) {
        throw new Error('BASELINE_CAPTURE_LOCK_TIMEOUT');
      }
      return await action();
    } finally {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } finally {
        connection.release();
      }
    }
  }
}

export async function loadScenarioBaselineBySourceFaultRunId(
  sourceFaultRunId: string,
): Promise<ScenarioBaseline | null> {
  await ensureBaselineSchema();
  const [rows] = await getPool().query(
    'SELECT * FROM scenario_baselines WHERE source_fault_run_id = ?',
    [sourceFaultRunId],
  );
  const row = asRecordArray(rows)[0];
  return row ? toScenarioBaseline(row) : null;
}

export async function loadScenarioBaselineById(
  baselineId: string,
): Promise<ScenarioBaseline | null> {
  await ensureBaselineSchema();
  const [rows] = await getPool().query(
    'SELECT * FROM scenario_baselines WHERE baseline_id = ?',
    [baselineId],
  );
  const row = asRecordArray(rows)[0];
  return row ? toScenarioBaseline(row) : null;
}

export async function listScenarioBaselines(
  filters: BaselineListFilters = {},
): Promise<ScenarioBaseline[]> {
  await ensureBaselineSchema();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.scenario) {
    conditions.push('scenario = ?');
    values.push(filters.scenario);
  }
  if (filters.captureStatus) {
    conditions.push('capture_status = ?');
    values.push(filters.captureStatus);
  }
  if (filters.catalogRevision) {
    conditions.push('catalog_revision = ?');
    values.push(filters.catalogRevision);
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const [rows] = await getPool().query(
    `SELECT * FROM scenario_baselines
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY created_at DESC, baseline_id DESC
     LIMIT ${limit}`,
    values,
  );
  return asRecordArray(rows).map(toScenarioBaseline);
}

export async function loadBaselinePilotReview(
  scenario: FaultRunScenario,
  catalogRevision: string,
): Promise<BaselinePilotReview | null> {
  await ensureBaselineSchema();
  const [rows] = await getPool().query(
    'SELECT * FROM baseline_pilot_reviews WHERE scenario = ? AND catalog_revision = ?',
    [scenario, catalogRevision],
  );
  const row = asRecordArray(rows)[0];
  return row ? toBaselinePilotReview(row) : null;
}

export async function listBaselinePilotReviews(
  filters: PilotReviewListFilters = {},
): Promise<BaselinePilotReview[]> {
  await ensureBaselineSchema();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.scenario) {
    conditions.push('scenario = ?');
    values.push(filters.scenario);
  }
  if (filters.catalogRevision) {
    conditions.push('catalog_revision = ?');
    values.push(filters.catalogRevision);
  }
  if (filters.decision) {
    conditions.push('decision = ?');
    values.push(filters.decision);
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const [rows] = await getPool().query(
    `SELECT * FROM baseline_pilot_reviews
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY reviewed_at DESC, review_id DESC
     LIMIT ${limit}`,
    values,
  );
  return asRecordArray(rows).map(toBaselinePilotReview);
}

function toScenarioBaseline(row: Record<string, unknown>): ScenarioBaseline {
  return {
    baselineId: String(row.baseline_id),
    scenario: String(row.scenario) as ScenarioBaseline['scenario'],
    sourceFaultRunId: String(row.source_fault_run_id),
    captureStatus: String(row.capture_status) as ScenarioBaseline['captureStatus'],
    catalogRevision: String(row.catalog_revision),
    releaseRevision: row.release_revision === null || row.release_revision === undefined
      ? null : String(row.release_revision),
    deploymentMode: String(row.deployment_mode) as ScenarioBaseline['deploymentMode'],
    schemaRevision: String(row.schema_revision) as ScenarioBaseline['schemaRevision'],
    dataWarmupEnabled: row.data_warmup_enabled === null || row.data_warmup_enabled === undefined
      ? null : Number(row.data_warmup_enabled) === 1,
    warmupConfig: parseJsonOrNull(row.warmup_config),
    lifecycle: parseJson(row.lifecycle_json) as ScenarioBaseline['lifecycle'],
    outcome: parseJson(row.outcome_json) as ScenarioBaseline['outcome'],
    requestSummary: parseJsonOrNull(row.request_summary_json),
    resourceBudget: parseJsonOrNull(row.resource_budget_json),
    resourceObservation: parseJsonOrNull(row.resource_observation_json),
    observationSummary: parseJson(row.observation_summary_json) as ScenarioBaseline['observationSummary'],
    alertSummary: parseJson(row.alert_summary_json) as ScenarioBaseline['alertSummary'],
    knownLimitations: parseJson(row.known_limitations) as ScenarioBaseline['knownLimitations'],
    residualResources: parseJson(row.residual_resources) as ScenarioBaseline['residualResources'],
    rollbackProcedure: parseJson(row.rollback_procedure) as ScenarioBaseline['rollbackProcedure'],
    createdByOperatorAuditId: row.created_by_operator_audit_id === null
      || row.created_by_operator_audit_id === undefined
      ? null : Number(row.created_by_operator_audit_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toBaselinePilotReview(row: Record<string, unknown>): BaselinePilotReview {
  return {
    reviewId: Number(row.review_id),
    scenario: String(row.scenario) as FaultRunScenario,
    catalogRevision: String(row.catalog_revision),
    decision: String(row.decision) as PilotReviewDecision,
    alertRules: parseJson(row.alert_rules) as BaselineAlertRule[],
    evidenceRequirements: parseJson(row.evidence_requirements) as BaselineLimitation[],
    retentionSnapshot: parseJson(row.retention_snapshot) as Record<string, string | number | boolean | null>,
    remediationBoundary: String(row.remediation_boundary),
    decisionReason: String(row.decision_reason),
    operatorAuditId: Number(row.operator_audit_id),
    reviewedAt: toIso(row.reviewed_at),
  };
}

function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseJsonOrNull<T>(value: unknown): T | null {
  return value === null || value === undefined ? null : parseJson(value) as T;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}
