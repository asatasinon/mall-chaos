import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { FaultRunScenario, FaultRunState } from './fault-run-catalog';
import type { FaultRunEventRecord } from './fault-run-repository';
import { getPool } from './db';
import {
  canonicalizeEvidenceRenderedRecipes,
  EvidenceTypeError,
  getEvidenceManifestHash,
  getEvidenceTimelineHash,
  parseEvidenceAttempt,
  parseEvidenceAttemptItem,
  parseEvidenceCaptureSnapshot,
  parseEvidenceJsonColumn,
  parseEvidenceManifest,
  parseEvidenceManifestDraft,
  parseEvidenceOperatorNote,
  parseEvidenceStoredContractSnapshot,
  parseEvidenceSqlTimestamp,
  serializeEvidenceCaptureSnapshot,
  type EvidenceAttemptItemRecord,
  type EvidenceAttemptRecord,
  type EvidenceCaptureSnapshotRecord,
  type EvidenceManifestDraft,
  type EvidenceManifestRecord,
  type EvidenceOperatorNoteRecord,
  type EvidenceStoredContractSnapshotRecord,
  type EvidenceStatus,
} from './evidence-types';
import { insertOperatorAudit } from './operator-audit';
import { ensureEvidenceSchema } from './evidence-schema';
import { ensureFaultRunSchema } from './fault-run-schema';
import { createEvidenceManifestDraft } from './evidence-manifest-materializer';
import { projectEvidenceTimeline, type EvidenceTimelineActionFact } from './evidence-timeline';

export type EvidenceRepositoryErrorCode =
  | 'EVIDENCE_REPOSITORY_INVALID_INPUT'
  | 'EVIDENCE_CONTRACT_SNAPSHOT_NOT_FOUND'
  | 'EVIDENCE_CONTRACT_SNAPSHOT_CONFLICT'
  | 'EVIDENCE_MANIFEST_NOT_FOUND'
  | 'EVIDENCE_MANIFEST_SOURCE_RUN_MISMATCH'
  | 'EVIDENCE_MANIFEST_HASH_CONFLICT'
  | 'EVIDENCE_SOURCE_RUN_NOT_RETAINED'
  | 'EVIDENCE_SOURCE_RUN_NOT_TERMINAL'
  | 'EVIDENCE_IDEMPOTENCY_KEY_REUSED'
  | 'EVIDENCE_ATTEMPT_NOT_FOUND'
  | 'EVIDENCE_ATTEMPT_NOT_RUNNING'
  | 'EVIDENCE_ATTEMPT_DEADLINE_EXCEEDED'
  | 'EVIDENCE_NOTE_NOT_FOUND'
  | 'EVIDENCE_AUDIT_WRITE_FAILED';

export class EvidenceRepositoryError extends Error {
  constructor(readonly code: EvidenceRepositoryErrorCode) {
    super(code);
    this.name = 'EvidenceRepositoryError';
  }
}

export interface EvidenceAuditContext {
  readonly operatorId: number | null;
  readonly correlationId: string | null;
}

export interface CreateEvidenceAttemptInput extends EvidenceAuditContext {
  readonly sourceFaultRunId: string;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly idempotencyKey: string;
  readonly totalTimeoutMs: number;
}

export interface EvidenceAttemptCreateResult {
  readonly attempt: EvidenceAttemptRecord;
  readonly created: boolean;
}

export interface EvidenceAttemptLookupInput {
  readonly sourceFaultRunId: string;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly idempotencyKey: string;
}

export interface CompleteEvidenceAttemptInput {
  readonly attemptId: string;
  readonly state: 'COMPLETED' | 'EVIDENCE_UNAVAILABLE' | 'FAILED';
  readonly evidenceStatus: EvidenceStatus | null;
  readonly failureCode: string | null;
  readonly totalDurationMs: number;
  readonly items: readonly EvidenceAttemptItemRecord[];
}

export interface CreateEvidenceNoteInput extends EvidenceAuditContext {
  readonly sourceFaultRunId: string;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly idempotencyKey: string;
  readonly text: string;
}

export interface EvidenceNoteCreateResult {
  readonly note: EvidenceOperatorNoteRecord;
  readonly created: boolean;
}

export interface EvidenceManifestListOptions {
  readonly limit?: number;
  readonly beforeRevision?: number;
}

export interface EvidenceHistoryListOptions {
  readonly limit?: number;
  readonly beforeAt?: string;
  readonly beforeId?: string;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TERMINAL_STATES = new Set<FaultRunState>([
  'RECOVERED',
  'STOPPED',
  'FAILED',
  'SERVICE_UNAVAILABLE',
]);
const MANIFEST_SELECT = `m.manifest_id AS manifest_id, m.snapshot_id AS snapshot_id,
  m.source_fault_run_id AS source_fault_run_id, m.scenario AS scenario,
  m.manifest_schema_version AS manifest_schema_version, m.contract_revision AS contract_revision,
  s.contract_hash AS contract_hash, s.rendered_plan_hash AS rendered_plan_hash,
  m.manifest_revision AS manifest_revision, m.timeline_hash AS timeline_hash,
  m.manifest_hash AS manifest_hash, m.timeline_json AS timeline_json,
  m.windows_json AS windows_json, m.recipes_json AS recipes_json,
  m.limitations_json AS limitations_json, m.source_run_retained AS source_run_retained,
  m.materialized_at AS materialized_at`;
const MANIFEST_FROM = `FROM evidence_query_manifests AS m
  JOIN evidence_contract_snapshots AS s ON s.snapshot_id = m.snapshot_id`;
const SNAPSHOT_SELECT = `snapshot_id, source_fault_run_id, scenario, contract_schema_version,
  contract_revision, contract_hash, contract_json, renderer_revision, evaluation_revision,
  rendered_plan_hash, rendered_plan_json, created_at`;
const ATTEMPT_SELECT = `attempt_id, manifest_id, source_fault_run_id, request_hash, state,
  evidence_status, operator_audit_id, requested_at, deadline_at, completed_at,
  total_duration_ms, failure_code`;
const NOTE_SELECT = `note_id, manifest_id, source_fault_run_id, request_hash,
  operator_audit_id, note_text, created_at`;

export class SqlEvidenceRepository {
  constructor(
    private readonly pool: Pool = getPool(),
    private readonly ensureEvidenceSchemaFn: () => Promise<void> = ensureEvidenceSchema,
    private readonly ensureFaultRunSchemaFn: () => Promise<void> = ensureFaultRunSchema,
  ) {}

  async loadContractSnapshot(sourceFaultRunId: string): Promise<EvidenceStoredContractSnapshotRecord | null> {
    assertUuid(sourceFaultRunId);
    await this.ensureSchemas();
    const [rows] = await this.pool.query(
      `SELECT ${SNAPSHOT_SELECT} FROM evidence_contract_snapshots WHERE source_fault_run_id = ?`,
      [sourceFaultRunId],
    );
    const row = firstRecord(rows);
    return row ? mapEvidenceSnapshot(row) : null;
  }

  async insertContractSnapshot(
    connection: PoolConnection,
    input: {
      readonly sourceFaultRunId: string;
      readonly scenario: FaultRunScenario;
      readonly snapshot: EvidenceCaptureSnapshotRecord;
    },
  ): Promise<string> {
    return insertEvidenceContractSnapshot(connection, input);
  }

  async getManifest(sourceFaultRunId: string, manifestId: string): Promise<EvidenceManifestRecord | null> {
    assertUuid(sourceFaultRunId);
    assertUuid(manifestId);
    await this.ensureSchemas();
    const [rows] = await this.pool.query(
      `SELECT ${MANIFEST_SELECT} ${MANIFEST_FROM}
       WHERE m.source_fault_run_id = ? AND m.manifest_id = ?`,
      [sourceFaultRunId, manifestId],
    );
    const row = firstRecord(rows);
    return row ? mapEvidenceManifest(row) : null;
  }

  async getLatestManifest(sourceFaultRunId: string): Promise<EvidenceManifestRecord | null> {
    assertUuid(sourceFaultRunId);
    await this.ensureSchemas();
    const [rows] = await this.pool.query(
      `SELECT ${MANIFEST_SELECT} ${MANIFEST_FROM}
       WHERE m.source_fault_run_id = ?
       ORDER BY m.manifest_revision DESC, m.manifest_id DESC LIMIT 1`,
      [sourceFaultRunId],
    );
    const row = firstRecord(rows);
    return row ? mapEvidenceManifest(row) : null;
  }

  async listManifests(
    sourceFaultRunId: string,
    options: EvidenceManifestListOptions = {},
  ): Promise<EvidenceManifestRecord[]> {
    assertUuid(sourceFaultRunId);
    const limit = boundedLimit(options.limit);
    if (options.beforeRevision !== undefined) assertPositiveInteger(options.beforeRevision);
    await this.ensureSchemas();
    const before = options.beforeRevision === undefined ? '' : 'AND m.manifest_revision < ?';
    const values = options.beforeRevision === undefined
      ? [sourceFaultRunId, limit]
      : [sourceFaultRunId, options.beforeRevision, limit];
    const [rows] = await this.pool.query(
      `SELECT ${MANIFEST_SELECT} ${MANIFEST_FROM}
       WHERE m.source_fault_run_id = ? ${before}
       ORDER BY m.manifest_revision DESC, m.manifest_id DESC LIMIT ?`,
      values,
    );
    return recordArray(rows).map(mapEvidenceManifest);
  }

  async getOrCreateManifest(draftValue: EvidenceManifestDraft): Promise<{
    readonly manifest: EvidenceManifestRecord;
    readonly created: boolean;
  }> {
    const draft = parseEvidenceManifestDraft(draftValue);
    const timelineHash = getEvidenceTimelineHash(draft.timeline);
    if (timelineHash !== draft.timelineHash) {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
    const manifestHash = getEvidenceManifestHash(draft);
    await this.ensureSchemas();
    await this.ensureFaultRunSchemaFn();
    const connection = await this.pool.getConnection();
    let transactionComplete = false;
    try {
      await connection.beginTransaction();
      const [runRows] = await connection.query(
        'SELECT state, scenario, contract_revision FROM fault_runs WHERE fault_run_id = ? FOR UPDATE',
        [draft.sourceFaultRunId],
      );
      const runRow = firstRecord(runRows);
      if (!runRow) throw new EvidenceRepositoryError('EVIDENCE_SOURCE_RUN_NOT_RETAINED');
      if (typeof runRow.state !== 'string' || !TERMINAL_STATES.has(runRow.state as FaultRunState)) {
        throw new EvidenceRepositoryError('EVIDENCE_SOURCE_RUN_NOT_TERMINAL');
      }
      if (runRow.state !== draft.timeline.terminalState) {
        throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_HASH_CONFLICT');
      }
      const [snapshotRows] = await connection.query(
        `SELECT ${SNAPSHOT_SELECT} FROM evidence_contract_snapshots
         WHERE source_fault_run_id = ? FOR UPDATE`,
        [draft.sourceFaultRunId],
      );
      const snapshotRow = firstRecord(snapshotRows);
      if (!snapshotRow) throw new EvidenceRepositoryError('EVIDENCE_CONTRACT_SNAPSHOT_NOT_FOUND');
      const snapshot = mapEvidenceSnapshot(snapshotRow);
      assertRunMatchesSnapshot(runRow, snapshot);
      const result = await this.materializeManifestWithConnection(
        connection,
        draft,
        snapshot,
        manifestHash,
      );
      await connection.commit();
      transactionComplete = true;
      return result;
    } catch (error) {
      if (!transactionComplete) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getOrCreateManifestForRun(sourceFaultRunId: string): Promise<{
    readonly manifest: EvidenceManifestRecord;
    readonly created: boolean;
  }> {
    assertUuid(sourceFaultRunId);
    await this.ensureSchemas();
    await this.ensureFaultRunSchemaFn();
    const connection = await this.pool.getConnection();
    let transactionComplete = false;
    try {
      await connection.beginTransaction();
      const result = await this.getOrCreateManifestForRunWithConnection(connection, sourceFaultRunId);
      await connection.commit();
      transactionComplete = true;
      return result;
    } catch (error) {
      if (!transactionComplete) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async preserveManifestBeforeRunRetention(
    connection: PoolConnection,
    sourceFaultRunId: string,
  ): Promise<boolean> {
    assertUuid(sourceFaultRunId);
    try {
      await this.getOrCreateManifestForRunWithConnection(connection, sourceFaultRunId);
    } catch (error) {
      if (error instanceof EvidenceRepositoryError
        && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_NOT_FOUND') return false;
      throw error;
    }
    await this.markSourceRunRetained(connection, sourceFaultRunId);
    return true;
  }

  private async getOrCreateManifestForRunWithConnection(
    connection: PoolConnection,
    sourceFaultRunId: string,
  ): Promise<{ readonly manifest: EvidenceManifestRecord; readonly created: boolean }> {
    const [runRows] = await connection.query(
      `SELECT fault_run_id, state, scenario, contract_revision,
              created_at, started_at, stopped_at, recovery_result
       FROM fault_runs WHERE fault_run_id = ? FOR UPDATE`,
      [sourceFaultRunId],
    );
    const runRow = firstRecord(runRows);
    if (!runRow) throw new EvidenceRepositoryError('EVIDENCE_SOURCE_RUN_NOT_RETAINED');
    if (!isTerminalFaultRunState(runRow.state)) {
      throw new EvidenceRepositoryError('EVIDENCE_SOURCE_RUN_NOT_TERMINAL');
    }

    const snapshot = await lockEvidenceSnapshot(connection, sourceFaultRunId);
    assertRunMatchesSnapshot(runRow, snapshot);
    const timeline = projectEvidenceTimeline(
      mapEvidenceTimelineRun(runRow),
      await loadEvidenceTimelineEvents(connection, sourceFaultRunId),
      await loadEvidenceTimelineActions(connection, sourceFaultRunId),
    );
    if (timeline.terminalState !== runRow.state) {
      throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_HASH_CONFLICT');
    }
    const draft = createEvidenceManifestDraft(snapshot, timeline);
    const manifestHash = getEvidenceManifestHash(draft);
    return this.materializeManifestWithConnection(
      connection,
      draft,
      snapshot,
      manifestHash,
    );
  }

  private async materializeManifestWithConnection(
    connection: PoolConnection,
    draft: EvidenceManifestDraft,
    snapshot: EvidenceStoredContractSnapshotRecord,
    manifestHash: string,
  ): Promise<{ readonly manifest: EvidenceManifestRecord; readonly created: boolean }> {
    assertManifestSnapshotMatch(draft, snapshot);
    const [existingRows] = await connection.query(
      `SELECT ${MANIFEST_SELECT} ${MANIFEST_FROM}
       WHERE m.source_fault_run_id = ? AND m.timeline_hash = ? FOR UPDATE`,
      [draft.sourceFaultRunId, draft.timelineHash],
    );
    const existingRow = firstRecord(existingRows);
    if (existingRow) {
      const existing = mapEvidenceManifest(existingRow);
      if (existing.manifestHash !== manifestHash
        || existing.snapshotId !== draft.snapshotId
        || existing.renderedPlanHash !== draft.renderedPlanHash) {
        throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_HASH_CONFLICT');
      }
      return { manifest: existing, created: false };
    }

    const [revisionRows] = await connection.query(
      `SELECT COALESCE(MAX(manifest_revision), 0) AS max_revision
       FROM evidence_query_manifests WHERE source_fault_run_id = ?`,
      [draft.sourceFaultRunId],
    );
    const maxRevision = Number(firstRecord(revisionRows)?.max_revision ?? 0);
    if (!Number.isSafeInteger(maxRevision) || maxRevision >= 0xffff_ffff) {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
    const manifestId = randomUUID();
    await connection.execute(
      `INSERT INTO evidence_query_manifests
        (manifest_id, snapshot_id, source_fault_run_id, scenario, manifest_schema_version,
         contract_revision, manifest_revision, timeline_hash, manifest_hash,
         timeline_json, windows_json, recipes_json, limitations_json, source_run_retained)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        manifestId,
        draft.snapshotId,
        draft.sourceFaultRunId,
        draft.scenario,
        draft.manifestSchemaVersion,
        draft.contractRevision,
        maxRevision + 1,
        draft.timelineHash,
        manifestHash,
        JSON.stringify(draft.timeline),
        JSON.stringify(draft.windows),
        JSON.stringify(draft.recipes),
        JSON.stringify(draft.limitations),
      ],
    );
    const [createdRows] = await connection.query(
      `SELECT ${MANIFEST_SELECT} ${MANIFEST_FROM} WHERE m.manifest_id = ?`,
      [manifestId],
    );
    const createdRow = firstRecord(createdRows);
    if (!createdRow) throw new Error('EVIDENCE_MANIFEST_CREATE_READBACK_FAILED');
    return { manifest: mapEvidenceManifest(createdRow), created: true };
  }

  async markSourceRunRetained(
    connection: PoolConnection,
    sourceFaultRunId: string,
  ): Promise<void> {
    assertUuid(sourceFaultRunId);
    await connection.execute(
      `UPDATE evidence_query_manifests
       SET source_run_retained = 0
       WHERE source_fault_run_id = ? AND source_run_retained = 1`,
      [sourceFaultRunId],
    );
  }

  async createReportAttempt(
    input: CreateEvidenceAttemptInput,
    settleExpiredAttempts = true,
  ): Promise<EvidenceAttemptCreateResult> {
    assertUuid(input.sourceFaultRunId);
    assertUuid(input.manifestId);
    assertSha256(input.manifestHash);
    assertIdempotencyKey(input.idempotencyKey);
    assertAuditContext(input);
    if (!Number.isInteger(input.totalTimeoutMs) || input.totalTimeoutMs < 1000 || input.totalTimeoutMs > 20_000) {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
    const requestHash = reportRequestHash(input.manifestId, input.manifestHash);
    await this.ensureSchemas();
    if (settleExpiredAttempts) await this.settleExpiredAttempts(input.sourceFaultRunId);
    const connection = await this.pool.getConnection();
    let transactionComplete = false;
    try {
      await connection.beginTransaction();
      const snapshot = await lockEvidenceSnapshot(connection, input.sourceFaultRunId);
      const [existingRows] = await connection.query(
        `SELECT ${ATTEMPT_SELECT} FROM evidence_query_attempts
         WHERE source_fault_run_id = ? AND idempotency_key = ? FOR UPDATE`,
        [input.sourceFaultRunId, input.idempotencyKey],
      );
      const existingRow = firstRecord(existingRows);
      if (existingRow) {
        const existing = mapEvidenceAttempt(existingRow);
        if (existing.requestHash !== requestHash) {
          throw new EvidenceRepositoryError('EVIDENCE_IDEMPOTENCY_KEY_REUSED');
        }
        await connection.commit();
        transactionComplete = true;
        return { attempt: existing, created: false };
      }
      const manifest = await loadManifestWithConnection(
        connection,
        input.sourceFaultRunId,
        input.manifestId,
        true,
      );
      if (!manifest) throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_NOT_FOUND');
      if (manifest.manifestHash !== input.manifestHash) {
        throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_HASH_CONFLICT');
      }
      assertManifestUsesSnapshot(manifest, snapshot);

      const attemptId = randomUUID();
      const operatorAuditId = await insertOperatorAudit(connection, {
        operatorId: input.operatorId,
        action: 'EVIDENCE_REPORT_EXECUTE',
        target: input.manifestId,
        parameters: {
          faultRunId: input.sourceFaultRunId,
          manifestId: input.manifestId,
          manifestRevision: manifest.manifestRevision,
          manifestHash: input.manifestHash,
          idempotencyKey: input.idempotencyKey,
        },
        result: 'SUCCESS',
        correlationId: input.correlationId ?? undefined,
      });
      if (!Number.isSafeInteger(operatorAuditId) || operatorAuditId < 1) {
        throw new EvidenceRepositoryError('EVIDENCE_AUDIT_WRITE_FAILED');
      }
      await connection.execute(
        `INSERT INTO evidence_query_attempts
          (attempt_id, manifest_id, source_fault_run_id, idempotency_key, request_hash,
           state, operator_audit_id, deadline_at)
         VALUES (?, ?, ?, ?, ?, 'RUNNING', ?,
           DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND))`,
        [
          attemptId,
          input.manifestId,
          input.sourceFaultRunId,
          input.idempotencyKey,
          requestHash,
          operatorAuditId,
          (input.totalTimeoutMs + 5000) * 1000,
        ],
      );
      const attempt = await loadAttemptWithConnection(connection, attemptId);
      if (!attempt) throw new Error('EVIDENCE_ATTEMPT_CREATE_READBACK_FAILED');
      await connection.commit();
      transactionComplete = true;
      return { attempt, created: true };
    } catch (error) {
      if (!transactionComplete) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getReportAttemptByIdempotencyKey(
    input: EvidenceAttemptLookupInput,
  ): Promise<EvidenceAttemptRecord | null> {
    assertUuid(input.sourceFaultRunId);
    assertUuid(input.manifestId);
    assertSha256(input.manifestHash);
    assertIdempotencyKey(input.idempotencyKey);
    const requestHash = reportRequestHash(input.manifestId, input.manifestHash);
    await this.ensureSchemas();
    await this.settleExpiredAttempts(input.sourceFaultRunId);
    const [rows] = await this.pool.query(
      `SELECT ${ATTEMPT_SELECT} FROM evidence_query_attempts
       WHERE source_fault_run_id = ? AND idempotency_key = ?`,
      [input.sourceFaultRunId, input.idempotencyKey],
    );
    const row = firstRecord(rows);
    if (!row) return null;
    const attempt = mapEvidenceAttempt(row);
    if (attempt.requestHash !== requestHash) {
      throw new EvidenceRepositoryError('EVIDENCE_IDEMPOTENCY_KEY_REUSED');
    }
    return attempt;
  }

  async completeReportAttempt(input: CompleteEvidenceAttemptInput): Promise<EvidenceAttemptRecord> {
    assertUuid(input.attemptId);
    if (!Number.isInteger(input.totalDurationMs) || input.totalDurationMs < 0
      || input.totalDurationMs > 0xffff_ffff || !isAttemptCompletionConsistent(input)) {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
    const items = input.items.map(parseEvidenceAttemptItem);
    if (new Set(items.map((item) => `${item.recipeId}\u0000${item.window}`)).size !== items.length) {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
    await this.ensureSchemas();
    const connection = await this.pool.getConnection();
    let transactionComplete = false;
    try {
      await connection.beginTransaction();
      const attempt = await loadAttemptWithConnection(connection, input.attemptId, true);
      if (!attempt) throw new EvidenceRepositoryError('EVIDENCE_ATTEMPT_NOT_FOUND');
      if (attempt.state !== 'RUNNING') throw new EvidenceRepositoryError('EVIDENCE_ATTEMPT_NOT_RUNNING');
      const manifest = await loadManifestWithConnection(
        connection,
        attempt.sourceFaultRunId,
        attempt.manifestId,
        true,
      );
      if (!manifest) throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_NOT_FOUND');
      assertAttemptItemsBelongToManifest(items, manifest);

      for (const item of items) {
        await connection.execute(
          `INSERT INTO evidence_query_attempt_items
            (attempt_id, recipe_id, source, window_name, availability, coverage,
             predicate_outcome, reason_code, duration_ms, queried_at,
             executed_start_at, executed_end_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.attemptId,
            item.recipeId,
            item.source,
            item.window,
            item.availability,
            item.coverage,
            item.predicateOutcome,
            item.reasonCode,
            item.durationMs,
            item.queriedAt,
            item.executedStartAt,
            item.executedEndAt,
          ],
        );
      }
      const [result] = await connection.execute(
        `UPDATE evidence_query_attempts
         SET state = ?, evidence_status = ?, completed_at = CURRENT_TIMESTAMP(3),
             total_duration_ms = ?, failure_code = ?
         WHERE attempt_id = ? AND state = 'RUNNING'
           AND deadline_at >= CURRENT_TIMESTAMP(3)`,
        [
          input.state,
          input.evidenceStatus,
          input.totalDurationMs,
          input.failureCode,
          input.attemptId,
        ],
      );
      if (affectedRows(result) !== 1) {
        throw new EvidenceRepositoryError('EVIDENCE_ATTEMPT_DEADLINE_EXCEEDED');
      }
      if (attempt.operatorAuditId !== null) {
        const [auditResult] = await connection.execute(
          'UPDATE operator_audit_logs SET result = ? WHERE id = ?',
          [input.state === 'FAILED' ? 'FAILURE' : 'SUCCESS', attempt.operatorAuditId],
        );
        if (affectedRows(auditResult) !== 1) {
          throw new EvidenceRepositoryError('EVIDENCE_AUDIT_WRITE_FAILED');
        }
      }
      const completed = await loadAttemptWithConnection(connection, input.attemptId);
      if (!completed) throw new Error('EVIDENCE_ATTEMPT_COMPLETE_READBACK_FAILED');
      await connection.commit();
      transactionComplete = true;
      return completed;
    } catch (error) {
      if (!transactionComplete) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async settleExpiredAttempts(sourceFaultRunId: string): Promise<number> {
    assertUuid(sourceFaultRunId);
    await this.ensureSchemas();
    const connection = await this.pool.getConnection();
    let transactionComplete = false;
    try {
      await connection.beginTransaction();
      await lockEvidenceSnapshot(connection, sourceFaultRunId);
      const [rows] = await connection.query(
        `SELECT ${ATTEMPT_SELECT} FROM evidence_query_attempts
         WHERE source_fault_run_id = ? AND state = 'RUNNING'
           AND deadline_at <= CURRENT_TIMESTAMP(3)
         ORDER BY requested_at, attempt_id LIMIT 100 FOR UPDATE`,
        [sourceFaultRunId],
      );
      const expired = recordArray(rows).map(mapEvidenceAttempt);
      let settled = 0;
      for (const attempt of expired) {
        const [result] = await connection.execute(
          `UPDATE evidence_query_attempts
           SET state = 'FAILED', completed_at = CURRENT_TIMESTAMP(3),
               total_duration_ms = GREATEST(0,
                 TIMESTAMPDIFF(MICROSECOND, requested_at, CURRENT_TIMESTAMP(3)) DIV 1000),
               failure_code = 'EXECUTION_INTERRUPTED'
           WHERE attempt_id = ? AND state = 'RUNNING'
             AND deadline_at <= CURRENT_TIMESTAMP(3)`,
          [attempt.attemptId],
        );
        if (affectedRows(result) === 1) {
          settled += 1;
          if (attempt.operatorAuditId !== null) {
            const [auditResult] = await connection.execute(
              'UPDATE operator_audit_logs SET result = ? WHERE id = ?',
              ['FAILURE', attempt.operatorAuditId],
            );
            if (affectedRows(auditResult) !== 1) {
              throw new EvidenceRepositoryError('EVIDENCE_AUDIT_WRITE_FAILED');
            }
          }
        }
      }
      await connection.commit();
      transactionComplete = true;
      return settled;
    } catch (error) {
      if (!transactionComplete) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listReportAttempts(
    sourceFaultRunId: string,
    options: EvidenceHistoryListOptions = {},
  ): Promise<EvidenceAttemptRecord[]> {
    assertUuid(sourceFaultRunId);
    const limit = boundedLimit(options.limit);
    const cursor = normalizedHistoryCursor(options);
    await this.settleExpiredAttempts(sourceFaultRunId);
    const before = cursor === null ? '' :
      'AND (requested_at < ? OR (requested_at = ? AND attempt_id < ?))';
    const values = cursor === null
      ? [sourceFaultRunId, limit]
      : [sourceFaultRunId, cursor.beforeAt, cursor.beforeAt, cursor.beforeId, limit];
    const [rows] = await this.pool.query(
      `SELECT ${ATTEMPT_SELECT} FROM evidence_query_attempts
       WHERE source_fault_run_id = ? ${before}
       ORDER BY requested_at DESC, attempt_id DESC LIMIT ?`,
      values,
    );
    return recordArray(rows).map(mapEvidenceAttempt);
  }

  async listReportAttemptItems(
    sourceFaultRunId: string,
    attemptId: string,
  ): Promise<EvidenceAttemptItemRecord[]> {
    assertUuid(sourceFaultRunId);
    assertUuid(attemptId);
    await this.ensureSchemas();
    const [rows] = await this.pool.query(
      `SELECT items.recipe_id, items.source, items.window_name, items.availability,
              items.coverage, items.predicate_outcome, items.reason_code,
              items.duration_ms, items.queried_at, items.executed_start_at, items.executed_end_at
       FROM evidence_query_attempt_items AS items
       JOIN evidence_query_attempts AS attempts ON attempts.attempt_id = items.attempt_id
       WHERE attempts.source_fault_run_id = ? AND attempts.attempt_id = ?
       ORDER BY items.recipe_id, items.window_name`,
      [sourceFaultRunId, attemptId],
    );
    return recordArray(rows).map((row) => parseEvidenceAttemptItem({
      recipeId: row.recipe_id,
      source: row.source,
      window: row.window_name,
      availability: row.availability,
      coverage: row.coverage,
      predicateOutcome: row.predicate_outcome,
      reasonCode: row.reason_code === null ? null : row.reason_code,
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      queriedAt: row.queried_at === null ? null : parseEvidenceSqlTimestamp(row.queried_at),
      executedStartAt: row.executed_start_at === null ? null : parseEvidenceSqlTimestamp(row.executed_start_at),
      executedEndAt: row.executed_end_at === null ? null : parseEvidenceSqlTimestamp(row.executed_end_at),
    }));
  }

  async createOperatorNote(input: CreateEvidenceNoteInput): Promise<EvidenceNoteCreateResult> {
    assertUuid(input.sourceFaultRunId);
    assertUuid(input.manifestId);
    assertSha256(input.manifestHash);
    assertIdempotencyKey(input.idempotencyKey);
    assertAuditContext(input);
    if (typeof input.text !== 'string' || input.text.trim().length === 0
      || Buffer.byteLength(input.text, 'utf8') > 2048
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.text)) {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
    const requestHash = noteRequestHash(input.manifestId, input.manifestHash, input.text);
    await this.ensureSchemas();
    const connection = await this.pool.getConnection();
    let transactionComplete = false;
    try {
      await connection.beginTransaction();
      const snapshot = await lockEvidenceSnapshot(connection, input.sourceFaultRunId);
      const manifest = await loadManifestWithConnection(connection, input.sourceFaultRunId, input.manifestId, true);
      if (!manifest) throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_NOT_FOUND');
      if (manifest.manifestHash !== input.manifestHash) {
        throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_HASH_CONFLICT');
      }
      assertManifestUsesSnapshot(manifest, snapshot);
      const [existingRows] = await connection.query(
        `SELECT ${NOTE_SELECT} FROM evidence_operator_notes
         WHERE source_fault_run_id = ? AND idempotency_key = ? FOR UPDATE`,
        [input.sourceFaultRunId, input.idempotencyKey],
      );
      const existingRow = firstRecord(existingRows);
      if (existingRow) {
        const existing = mapEvidenceNote(existingRow);
        if (existing.requestHash !== requestHash) {
          throw new EvidenceRepositoryError('EVIDENCE_IDEMPOTENCY_KEY_REUSED');
        }
        await connection.commit();
        transactionComplete = true;
        return { note: existing, created: false };
      }

      const noteId = randomUUID();
      const operatorAuditId = await insertOperatorAudit(connection, {
        operatorId: input.operatorId,
        action: 'EVIDENCE_NOTE_CREATE',
        target: input.manifestId,
        parameters: {
          noteId,
          noteLength: Buffer.byteLength(input.text, 'utf8'),
          manifestRevision: manifest.manifestRevision,
        },
        result: 'SUCCESS',
        correlationId: input.correlationId ?? undefined,
      });
      if (!Number.isSafeInteger(operatorAuditId) || operatorAuditId < 1) {
        throw new EvidenceRepositoryError('EVIDENCE_AUDIT_WRITE_FAILED');
      }
      await connection.execute(
        `INSERT INTO evidence_operator_notes
          (note_id, manifest_id, source_fault_run_id, idempotency_key, request_hash,
           operator_audit_id, note_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          noteId,
          input.manifestId,
          input.sourceFaultRunId,
          input.idempotencyKey,
          requestHash,
          operatorAuditId,
          input.text,
        ],
      );
      const [noteRows] = await connection.query(
        `SELECT ${NOTE_SELECT} FROM evidence_operator_notes WHERE note_id = ?`,
        [noteId],
      );
      const noteRow = firstRecord(noteRows);
      if (!noteRow) throw new Error('EVIDENCE_NOTE_CREATE_READBACK_FAILED');
      const note = mapEvidenceNote(noteRow);
      await connection.commit();
      transactionComplete = true;
      return { note, created: true };
    } catch (error) {
      if (!transactionComplete) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listOperatorNotes(
    sourceFaultRunId: string,
    options: EvidenceHistoryListOptions = {},
  ): Promise<EvidenceOperatorNoteRecord[]> {
    assertUuid(sourceFaultRunId);
    const limit = boundedLimit(options.limit);
    const cursor = normalizedHistoryCursor(options);
    await this.ensureSchemas();
    const before = cursor === null ? '' :
      'AND (created_at < ? OR (created_at = ? AND note_id < ?))';
    const values = cursor === null
      ? [sourceFaultRunId, limit]
      : [sourceFaultRunId, cursor.beforeAt, cursor.beforeAt, cursor.beforeId, limit];
    const [rows] = await this.pool.query(
      `SELECT ${NOTE_SELECT} FROM evidence_operator_notes
       WHERE source_fault_run_id = ? ${before}
       ORDER BY created_at DESC, note_id DESC LIMIT ?`,
      values,
    );
    return recordArray(rows).map(mapEvidenceNote);
  }

  private ensureSchemas(): Promise<void> {
    return this.ensureEvidenceSchemaFn();
  }
}

export async function loadEvidenceManifestWithConnection(
  connection: PoolConnection,
  sourceFaultRunId: string,
  manifestId: string,
  forUpdate = false,
): Promise<EvidenceManifestRecord | null> {
  assertUuid(sourceFaultRunId);
  assertUuid(manifestId);
  const [rows] = await connection.query(
    `SELECT ${MANIFEST_SELECT} ${MANIFEST_FROM}
     WHERE m.source_fault_run_id = ? AND m.manifest_id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [sourceFaultRunId, manifestId],
  );
  const row = firstRecord(rows);
  return row ? mapEvidenceManifest(row) : null;
}

export async function insertEvidenceContractSnapshot(
  connection: PoolConnection,
  input: {
    readonly sourceFaultRunId: string;
    readonly scenario: FaultRunScenario;
    readonly snapshot: EvidenceCaptureSnapshotRecord;
  },
): Promise<string> {
  assertUuid(input.sourceFaultRunId);
  const serialized = serializeEvidenceCaptureSnapshot(input.snapshot);
  const snapshotId = randomUUID();
  await connection.execute(
    `INSERT INTO evidence_contract_snapshots
      (snapshot_id, source_fault_run_id, scenario, contract_schema_version,
       contract_revision, contract_hash, contract_json, renderer_revision,
       evaluation_revision, rendered_plan_hash, rendered_plan_json)
     VALUES (?, ?, ?, 'evidence-contract.v1', ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshotId,
      input.sourceFaultRunId,
      input.scenario,
      serialized.contractRevision,
      serialized.contractHash,
      serialized.contractJson,
      serialized.rendererRevision,
      serialized.evaluationRevision,
      serialized.renderedPlanHash,
      serialized.renderedPlanJson,
    ],
  );
  return snapshotId;
}

export async function lockEvidenceSnapshot(
  connection: PoolConnection,
  sourceFaultRunId: string,
): Promise<EvidenceStoredContractSnapshotRecord> {
  assertUuid(sourceFaultRunId);
  const [rows] = await connection.query(
    `SELECT ${SNAPSHOT_SELECT} FROM evidence_contract_snapshots
     WHERE source_fault_run_id = ? FOR UPDATE`,
    [sourceFaultRunId],
  );
  const row = firstRecord(rows);
  if (!row) throw new EvidenceRepositoryError('EVIDENCE_CONTRACT_SNAPSHOT_NOT_FOUND');
  return mapEvidenceSnapshot(row);
}

function isTerminalFaultRunState(value: unknown): value is FaultRunState {
  return typeof value === 'string' && TERMINAL_STATES.has(value as FaultRunState);
}

function mapEvidenceTimelineRun(row: Record<string, unknown>): {
  readonly faultRunId: string;
  readonly state: FaultRunState;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly stoppedAt: string | null;
  readonly recoveryResult: unknown;
} {
  if (typeof row.fault_run_id !== 'string' || !isTerminalFaultRunState(row.state)) {
    throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
  }
  return {
    faultRunId: row.fault_run_id,
    state: row.state,
    createdAt: parseEvidenceSqlTimestamp(row.created_at),
    startedAt: nullableTimelineTimestamp(row.started_at),
    stoppedAt: nullableTimelineTimestamp(row.stopped_at),
    recoveryResult: parseEvidenceJsonColumn(row.recovery_result),
  };
}

async function loadEvidenceTimelineEvents(
  connection: PoolConnection,
  sourceFaultRunId: string,
): Promise<FaultRunEventRecord[]> {
  const [rows] = await connection.query(
    `SELECT id, fault_run_id, event_type, payload, created_at
     FROM fault_run_events WHERE fault_run_id = ? ORDER BY created_at, id FOR UPDATE`,
    [sourceFaultRunId],
  );
  return recordArray(rows).map((row) => {
    if (typeof row.event_type !== 'string') {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
    return {
      id: Number(row.id),
      faultRunId: String(row.fault_run_id),
      eventType: row.event_type,
      payload: parseEvidenceJsonColumn(row.payload),
      createdAt: parseEvidenceSqlTimestamp(row.created_at),
    };
  });
}

async function loadEvidenceTimelineActions(
  connection: PoolConnection,
  sourceFaultRunId: string,
): Promise<EvidenceTimelineActionFact[]> {
  const [tableRows] = await connection.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    ['fault_run_actions'],
  );
  if (recordArray(tableRows).length === 0) return [];
  const [rows] = await connection.query(
    `SELECT action_id, fault_run_id, action_type, dispatch_started_at
     FROM fault_run_actions WHERE fault_run_id = ?
     ORDER BY requested_at, action_id FOR UPDATE`,
    [sourceFaultRunId],
  );
  return recordArray(rows).map((row) => {
    if (typeof row.action_id !== 'string'
      || typeof row.fault_run_id !== 'string'
      || typeof row.action_type !== 'string'
      || !(row.dispatch_started_at === null || row.dispatch_started_at instanceof Date
        || typeof row.dispatch_started_at === 'string')) {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
    return {
      actionId: row.action_id,
      faultRunId: row.fault_run_id,
      actionType: row.action_type,
      dispatchStartedAt: row.dispatch_started_at === null
        ? null
        : parseEvidenceSqlTimestamp(row.dispatch_started_at),
    };
  });
}

function nullableTimelineTimestamp(value: unknown): string | null {
  return value === null ? null : parseEvidenceSqlTimestamp(value);
}

async function loadManifestWithConnection(
  connection: PoolConnection,
  sourceFaultRunId: string,
  manifestId: string,
  forUpdate = false,
): Promise<EvidenceManifestRecord | null> {
  return loadEvidenceManifestWithConnection(connection, sourceFaultRunId, manifestId, forUpdate);
}

async function loadAttemptWithConnection(
  connection: PoolConnection,
  attemptId: string,
  forUpdate = false,
): Promise<EvidenceAttemptRecord | null> {
  const [rows] = await connection.query(
    `SELECT ${ATTEMPT_SELECT} FROM evidence_query_attempts
     WHERE attempt_id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [attemptId],
  );
  const row = firstRecord(rows);
  return row ? mapEvidenceAttempt(row) : null;
}

function mapEvidenceSnapshot(row: Record<string, unknown>): EvidenceStoredContractSnapshotRecord {
  const capture = parseEvidenceCaptureSnapshot({
    contractRevision: row.contract_revision,
    contractHash: row.contract_hash,
    contractJson: row.contract_json,
    rendererRevision: row.renderer_revision,
    evaluationRevision: row.evaluation_revision,
    renderedPlanHash: row.rendered_plan_hash,
    renderedPlanJson: row.rendered_plan_json,
  });
  return parseEvidenceStoredContractSnapshot({
    snapshotId: row.snapshot_id,
    sourceFaultRunId: row.source_fault_run_id,
    scenario: row.scenario,
    contractSchemaVersion: row.contract_schema_version,
    contractRevision: capture.contractRevision,
    contractHash: capture.contractHash,
    evidence: capture.evidence,
    rendererRevision: capture.renderedPlan.rendererRevision,
    evaluationRevision: capture.renderedPlan.evaluationRevision,
    renderedPlanHash: capture.renderedPlanHash,
    renderedPlan: capture.renderedPlan,
    createdAt: parseEvidenceSqlTimestamp(row.created_at),
  });
}

function mapEvidenceManifest(row: Record<string, unknown>): EvidenceManifestRecord {
  const sourceRunRetained = Number(row.source_run_retained);
  if (sourceRunRetained !== 0 && sourceRunRetained !== 1) {
    throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_HASH_CONFLICT');
  }
  return parseEvidenceManifest({
    manifestSchemaVersion: row.manifest_schema_version,
    manifestId: row.manifest_id,
    snapshotId: row.snapshot_id,
    sourceFaultRunId: row.source_fault_run_id,
    scenario: row.scenario,
    contractRevision: row.contract_revision,
    contractHash: row.contract_hash,
    renderedPlanHash: row.rendered_plan_hash,
    manifestRevision: Number(row.manifest_revision),
    timelineHash: row.timeline_hash,
    manifestHash: row.manifest_hash,
    timeline: parseEvidenceJsonColumn(row.timeline_json),
    windows: parseEvidenceJsonColumn(row.windows_json),
    recipes: parseEvidenceJsonColumn(row.recipes_json),
    limitations: parseEvidenceJsonColumn(row.limitations_json),
    sourceRunRetained: sourceRunRetained === 1,
    materializedAt: parseEvidenceSqlTimestamp(row.materialized_at),
  });
}

function mapEvidenceAttempt(row: Record<string, unknown>): EvidenceAttemptRecord {
  return parseEvidenceAttempt({
    attemptId: row.attempt_id,
    manifestId: row.manifest_id,
    sourceFaultRunId: row.source_fault_run_id,
    requestHash: row.request_hash,
    state: row.state,
    evidenceStatus: row.evidence_status ?? null,
    operatorAuditId: row.operator_audit_id === null ? null : Number(row.operator_audit_id),
    requestedAt: parseEvidenceSqlTimestamp(row.requested_at),
    deadlineAt: parseEvidenceSqlTimestamp(row.deadline_at),
    completedAt: row.completed_at === null ? null : parseEvidenceSqlTimestamp(row.completed_at),
    totalDurationMs: row.total_duration_ms === null ? null : Number(row.total_duration_ms),
    failureCode: row.failure_code ?? null,
  });
}

function mapEvidenceNote(row: Record<string, unknown>): EvidenceOperatorNoteRecord {
  return parseEvidenceOperatorNote({
    noteId: row.note_id,
    manifestId: row.manifest_id,
    sourceFaultRunId: row.source_fault_run_id,
    requestHash: row.request_hash,
    operatorAuditId: Number(row.operator_audit_id),
    text: row.note_text,
    createdAt: parseEvidenceSqlTimestamp(row.created_at),
  });
}

function assertManifestSnapshotMatch(
  draft: EvidenceManifestDraft,
  snapshot: EvidenceStoredContractSnapshotRecord,
): void {
  if (draft.snapshotId !== snapshot.snapshotId
    || draft.sourceFaultRunId !== snapshot.sourceFaultRunId
    || draft.scenario !== snapshot.scenario) {
    throw new EvidenceRepositoryError('EVIDENCE_CONTRACT_SNAPSHOT_CONFLICT');
  }
  if (draft.contractRevision !== snapshot.contractRevision
    || draft.contractHash !== snapshot.contractHash
    || draft.renderedPlanHash !== snapshot.renderedPlanHash
    || canonicalizeEvidenceRenderedRecipes(draft.recipes)
      !== canonicalizeEvidenceRenderedRecipes(snapshot.renderedPlan.recipes)) {
    throw new EvidenceRepositoryError('EVIDENCE_CONTRACT_SNAPSHOT_CONFLICT');
  }
}

function assertManifestUsesSnapshot(
  manifest: EvidenceManifestRecord,
  snapshot: EvidenceStoredContractSnapshotRecord,
): void {
  if (manifest.snapshotId !== snapshot.snapshotId
    || manifest.sourceFaultRunId !== snapshot.sourceFaultRunId
    || manifest.scenario !== snapshot.scenario
    || manifest.contractRevision !== snapshot.contractRevision
    || manifest.contractHash !== snapshot.contractHash
    || manifest.renderedPlanHash !== snapshot.renderedPlanHash) {
    throw new EvidenceRepositoryError('EVIDENCE_MANIFEST_HASH_CONFLICT');
  }
}

function assertRunMatchesSnapshot(
  run: Record<string, unknown>,
  snapshot: EvidenceStoredContractSnapshotRecord,
): void {
  if (run.scenario !== snapshot.scenario
    || run.contract_revision !== snapshot.contractRevision) {
    throw new EvidenceRepositoryError('EVIDENCE_CONTRACT_SNAPSHOT_CONFLICT');
  }
}

function assertAttemptItemsBelongToManifest(
  items: readonly EvidenceAttemptItemRecord[],
  manifest: EvidenceManifestRecord,
): void {
  for (const item of items) {
    const recipe = manifest.recipes.find((candidate) =>
      candidate.recipeId === item.recipeId && candidate.window === item.window);
    if (!recipe || recipe.source !== item.source) {
      throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
    }
  }
}

function reportRequestHash(manifestId: string, manifestHash: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ manifestId, manifestHash, confirmed: true }), 'utf8')
    .digest('hex');
}

function noteRequestHash(manifestId: string, manifestHash: string, text: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ manifestId, manifestHash, text }), 'utf8')
    .digest('hex');
}

function normalizedHistoryCursor(
  options: EvidenceHistoryListOptions,
): { beforeAt: string; beforeId: string } | null {
  if ((options.beforeAt === undefined) !== (options.beforeId === undefined)) {
    throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
  }
  if (options.beforeAt === undefined || options.beforeId === undefined) return null;
  assertUuid(options.beforeId);
  try {
    const timestamp = parseEvidenceSqlTimestamp(options.beforeAt);
    return {
      beforeAt: `${timestamp.slice(0, 10)} ${timestamp.slice(11, 23)}`,
      beforeId: options.beforeId,
    };
  } catch (error) {
    if (!(error instanceof EvidenceTypeError)) throw error;
    throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
  }
}

function isAttemptCompletionConsistent(input: CompleteEvidenceAttemptInput): boolean {
  if (input.state === 'COMPLETED') {
    return input.evidenceStatus === 'AVAILABLE' || input.evidenceStatus === 'PARTIAL'
      || input.evidenceStatus === 'INVALID_QUERY' && input.failureCode === null;
  }
  if (input.state === 'EVIDENCE_UNAVAILABLE') {
    return input.evidenceStatus === 'EVIDENCE_UNAVAILABLE' && input.failureCode === null;
  }
  return input.evidenceStatus === null
    && typeof input.failureCode === 'string'
    && /^[A-Z][A-Z0-9_]{0,63}$/u.test(input.failureCode);
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
  }
  return value;
}

function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
  }
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
  }
}

function assertSha256(value: string): void {
  if (!SHA256_PATTERN.test(value)) throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
}

function assertIdempotencyKey(value: string): void {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
}

function assertAuditContext(input: EvidenceAuditContext): void {
  if (!(input.operatorId === null
    || Number.isSafeInteger(input.operatorId) && input.operatorId > 0)
    || !(input.correlationId === null
      || typeof input.correlationId === 'string' && input.correlationId.length <= 128
        && !/[\u0000-\u001f\u007f]/u.test(input.correlationId))) {
    throw new EvidenceRepositoryError('EVIDENCE_REPOSITORY_INVALID_INPUT');
  }
}

function affectedRows(result: unknown): number {
  return isObjectRecord(result) && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const rows = recordArray(value);
  return rows[0] ?? null;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((row) => !isObjectRecord(row))) {
    throw new EvidenceTypeError('EVIDENCE_JSON_INVALID');
  }
  return value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return true;
}
