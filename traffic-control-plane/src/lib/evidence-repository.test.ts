import assert from 'node:assert/strict';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import type { FaultRunScenario } from './fault-run-catalog';
import {
  canonicalizeEvidenceContractPlan,
  getScenarioContractRevision,
  resolveScenarioContract,
  type EvidenceRecipeDefinition,
} from './scenario-contract';
import {
  canonicalizeEvidenceRenderedPlan,
  createEvidenceCaptureSnapshot,
  EVIDENCE_EVALUATION_REVISION,
  getEvidenceManifestHash,
  getEvidenceRenderedPlanHash,
  getEvidenceTimelineHash,
  EVIDENCE_RENDERER_REVISION,
  parseEvidenceManifest,
  parseEvidenceManifestDraft,
  serializeEvidenceCaptureSnapshot,
  type EvidenceRenderedPlan,
  type RenderedEvidenceRecipe,
} from './evidence-types';
import {
  EvidenceRepositoryError,
  SqlEvidenceRepository,
} from './evidence-repository';

const SOURCE_RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const SNAPSHOT_ID = '223e4567-e89b-12d3-a456-426614174001';
const NOW = Date.parse('2026-10-09T06:00:00.000Z');

test('manifest repository locks run then snapshot and allocates a stable per-run revision', async () => {
  const { repository, state, draft } = createFixture();
  const expectedHash = getEvidenceManifestHash(draft);
  assert.equal(parseEvidenceManifest({
    ...draft,
    manifestId: '323e4567-e89b-12d3-a456-426614174002',
    manifestRevision: 1,
    manifestHash: expectedHash,
    sourceRunRetained: true,
    materializedAt: '2026-10-09T06:00:00.000Z',
  }).manifestHash, expectedHash);
  const first = await repository.getOrCreateManifest(draft);
  assert.equal(first.created, true);
  assert.equal(first.manifest.manifestRevision, 1);
  assert.equal(first.manifest.manifestHash, getEvidenceManifestHash(draft));
  assert.ok(state.queries.findIndex((sql) => sql.includes('FROM fault_runs'))
    < state.queries.findIndex((sql) => sql.includes('FROM evidence_contract_snapshots') && sql.includes('FOR UPDATE')));

  const replay = await repository.getOrCreateManifest(draft);
  assert.equal(replay.created, false);
  assert.equal(replay.manifest.manifestId, first.manifest.manifestId);
  assert.equal(state.manifests.length, 1);

  const secondTimeline = {
    ...draft.timeline,
    cleanupFinishedAt: '2026-10-09T06:01:00.000Z',
    terminalAt: '2026-10-09T06:01:00.000Z',
  };
  const second = await repository.getOrCreateManifest(parseEvidenceManifestDraft({
    ...draft,
    timeline: secondTimeline,
    timelineHash: getEvidenceTimelineHash(secondTimeline),
  }));
  assert.equal(second.created, true);
  assert.equal(second.manifest.manifestRevision, 2);
});

test('concurrent manifest materialization reuses one revision under the source-run lock', async () => {
  const { repository, state, draft } = createFixture();
  const [first, second] = await Promise.all([
    repository.getOrCreateManifest(draft),
    repository.getOrCreateManifest(draft),
  ]);
  assert.equal(state.manifests.length, 1);
  assert.equal(first.manifest.manifestRevision, 1);
  assert.equal(second.manifest.manifestRevision, 1);
  assert.equal(first.manifest.manifestId, second.manifest.manifestId);
  assert.equal([first.created, second.created].filter(Boolean).length, 1);
});

test('snapshot persistence writes only the frozen protocol and returns its durable row identity', async () => {
  const { repository, state, snapshot } = createFixture();
  state.snapshots.length = 0;
  const connection = await new FakePool(state).getConnection();
  await connection.beginTransaction();
  const snapshotId = await repository.insertContractSnapshot(
    connection as unknown as PoolConnection,
    { sourceFaultRunId: SOURCE_RUN_ID, scenario: 'BROWSE_REPORT_SQL', snapshot },
  );
  await connection.commit();
  connection.release();
  const loaded = await repository.loadContractSnapshot(SOURCE_RUN_ID);
  assert.equal(loaded?.snapshotId, snapshotId);
  assert.equal(loaded?.contractRevision, snapshot.contractRevision);
  assert.equal(loaded?.contractHash, snapshot.contractHash);
  assert.equal(loaded?.renderedPlanHash, snapshot.renderedPlanHash);
  assert.equal(JSON.stringify(state.snapshots).includes('http://'), false);
});

test('Run materialization uses persisted plan, actions and events without calling the current renderer', async () => {
  const { repository, state, snapshot, draft } = createFixture();
  const recipes = snapshot.renderedPlan.recipes.map((recipe, index) => {
    if (index !== 0 || recipe.renderedQuery === null) return recipe;
    return { ...recipe, renderedQuery: 'frozen-query-from-capture' };
  });
  const persistedSnapshot = createEvidenceCaptureSnapshot(
    snapshot.contractRevision,
    snapshot.evidence,
    { ...snapshot.renderedPlan, recipes },
  );
  const serialized = serializeEvidenceCaptureSnapshot(persistedSnapshot);
  Object.assign(state.snapshots[0]!, {
    contract_revision: serialized.contractRevision,
    contract_hash: serialized.contractHash,
    contract_json: serialized.contractJson,
    renderer_revision: serialized.rendererRevision,
    evaluation_revision: serialized.evaluationRevision,
    rendered_plan_hash: serialized.renderedPlanHash,
    rendered_plan_json: serialized.renderedPlanJson,
  });

  const result = await repository.getOrCreateManifestForRun(SOURCE_RUN_ID);
  assert.equal(result.created, true);
  assert.equal(result.manifest.contractRevision, persistedSnapshot.contractRevision);
  assert.equal(result.manifest.contractHash, persistedSnapshot.contractHash);
  assert.equal(result.manifest.renderedPlanHash, getEvidenceRenderedPlanHash(persistedSnapshot.renderedPlan));
  assert.equal(result.manifest.recipes.some((recipe) =>
    recipe.renderedQuery === 'frozen-query-from-capture'), true);
  assert.deepEqual(result.manifest.timeline, draft.timeline);
  assert.deepEqual(result.manifest.windows.find((window) => window.name === 'cleanup'), {
    name: 'cleanup',
    state: 'NOT_APPLICABLE',
    canonicalStartAt: null,
    canonicalEndAt: null,
    reasonCode: 'CLEANUP_NOT_APPLICABLE',
  });
  assert.ok(state.queries.findIndex((sql) => sql.includes('FROM fault_runs') && sql.includes('FOR UPDATE'))
    < state.queries.findIndex((sql) => sql.includes('FROM evidence_contract_snapshots') && sql.includes('FOR UPDATE')));
});

test('retention preservation materializes the frozen Manifest and marks it not retained in caller transaction', async () => {
  const { repository, state } = createFixture();
  const pool = (repository as unknown as { pool: FakePool }).pool;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  const preserved = await repository.preserveManifestBeforeRunRetention(
    connection as unknown as PoolConnection,
    SOURCE_RUN_ID,
  );

  assert.equal(preserved, true);
  assert.equal(state.manifests.length, 1);
  assert.equal(state.manifests[0]?.source_run_retained, 0);
  assert.ok(state.queries.some((sql) => sql.includes('FROM fault_run_events')));
  assert.ok(state.queries.some((sql) => sql.includes('FROM fault_run_actions')));
  await connection.commit();
  connection.release();
});

test('retention leaves legacy runs without snapshots unmaterialized', async () => {
  const { repository, state } = createFixture();
  state.snapshots.length = 0;
  const pool = (repository as unknown as { pool: FakePool }).pool;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  const preserved = await repository.preserveManifestBeforeRunRetention(
    connection as unknown as PoolConnection,
    SOURCE_RUN_ID,
  );

  assert.equal(preserved, false);
  assert.equal(state.manifests.length, 0);
  await connection.commit();
  connection.release();
});

test('retention and concurrent materialization share the run lock and preserve one revision', async () => {
  const { repository, state } = createFixture('NOTIFICATION_STORAGE_APPEND');
  state.events.push({
    id: 5,
    fault_run_id: SOURCE_RUN_ID,
    event_type: 'MANUAL_CLEANUP_COMPLETED',
    payload: {},
    created_at: dbTimestamp(Date.parse('2026-10-09T06:01:00.000Z')),
  });
  const pool = (repository as unknown as { pool: FakePool }).pool;
  const preserveInTransaction = async () => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
      const preserved = await repository.preserveManifestBeforeRunRetention(
        connection as unknown as PoolConnection,
        SOURCE_RUN_ID,
      );
      await connection.commit();
      return preserved;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  const [materialized, preserved] = await Promise.all([
    repository.getOrCreateManifestForRun(SOURCE_RUN_ID),
    preserveInTransaction(),
  ]);

  assert.equal(preserved, true);
  assert.equal(state.manifests.length, 1);
  assert.equal(state.manifests[0]?.manifest_revision, 1);
  assert.equal(state.manifests[0]?.source_run_retained, 0);
  assert.equal((await repository.getManifest(SOURCE_RUN_ID, materialized.manifest.manifestId))
    ?.sourceRunRetained, false);
});

test('retention transaction rollback leaves source rows and Manifest metadata unchanged on materializer failure', async () => {
  const { repository, state } = createFixture();
  state.runContractRevision = `sc.v1:sha256:${'b'.repeat(64)}`;
  const pool = (repository as unknown as { pool: FakePool }).pool;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  await assert.rejects(
    repository.preserveManifestBeforeRunRetention(
      connection as unknown as PoolConnection,
      SOURCE_RUN_ID,
    ),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_CONFLICT',
  );
  await connection.rollback();
  connection.release();

  assert.equal(state.manifests.length, 0);
  assert.equal(state.snapshots.length, 1);
  assert.equal(state.events.length, 4);
});

test('concurrent Run materialization is idempotent and cleanup facts create a new revision', async () => {
  const { repository, state } = createFixture('NOTIFICATION_STORAGE_APPEND');
  const [first, replay] = await Promise.all([
    repository.getOrCreateManifestForRun(SOURCE_RUN_ID),
    repository.getOrCreateManifestForRun(SOURCE_RUN_ID),
  ]);
  assert.equal(state.manifests.length, 1);
  assert.equal(first.manifest.manifestRevision, 1);
  assert.equal(replay.manifest.manifestRevision, 1);
  assert.equal(first.manifest.manifestId, replay.manifest.manifestId);
  assert.equal([first.created, replay.created].filter(Boolean).length, 1);
  assert.equal(first.manifest.windows.find((window) => window.name === 'cleanup')?.state, 'NOT_READY');

  const createdAttempt = await repository.createReportAttempt({
    sourceFaultRunId: SOURCE_RUN_ID,
    manifestId: first.manifest.manifestId,
    manifestHash: first.manifest.manifestHash,
    idempotencyKey: 'materialized-attempt-001',
    totalTimeoutMs: 1000,
    operatorId: 7,
    correlationId: null,
  });
  state.events.push({
    id: 5,
    fault_run_id: SOURCE_RUN_ID,
    event_type: 'MANUAL_CLEANUP_COMPLETED',
    payload: {},
    created_at: dbTimestamp(Date.parse('2026-10-09T06:01:00.000Z')),
  });

  const second = await repository.getOrCreateManifestForRun(SOURCE_RUN_ID);
  assert.equal(second.created, true);
  assert.equal(second.manifest.manifestRevision, 2);
  assert.equal(second.manifest.windows.find((window) => window.name === 'cleanup')?.state, 'READY');
  assert.equal((await repository.getManifest(SOURCE_RUN_ID, first.manifest.manifestId))?.manifestHash,
    first.manifest.manifestHash);
  assert.equal(state.attempts[0]?.manifest_id, createdAttempt.attempt.manifestId);
  assert.equal(state.attempts[0]?.manifest_id, first.manifest.manifestId);
  assert.equal((await repository.getLatestManifest(SOURCE_RUN_ID))?.manifestId, second.manifest.manifestId);
});

test('Run materialization rejects a snapshot detached from the Fault Run Contract revision', async () => {
  const { repository, state } = createFixture();
  state.snapshots[0]!.contract_revision = `sc.v1:sha256:${'b'.repeat(64)}`;
  await assert.rejects(
    repository.getOrCreateManifestForRun(SOURCE_RUN_ID),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_CONFLICT',
  );
  assert.equal(state.manifests.length, 0);
});

test('Run materialization rejects active Runs before creating a Manifest', async () => {
  const { repository, state } = createFixture();
  state.runState = 'ACTIVE';
  await assert.rejects(
    repository.getOrCreateManifestForRun(SOURCE_RUN_ID),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_SOURCE_RUN_NOT_TERMINAL',
  );
  assert.equal(state.manifests.length, 0);
});

test('Run materialization reports a missing capture snapshot without rebuilding from the Catalog', async () => {
  const { repository, state } = createFixture();
  state.snapshots.length = 0;
  await assert.rejects(
    repository.getOrCreateManifestForRun(SOURCE_RUN_ID),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_NOT_FOUND',
  );
  assert.equal(state.manifests.length, 0);
});

test('Run materialization rejects a corrupted frozen renderer protocol', async () => {
  const { repository, state, snapshot } = createFixture();
  state.snapshots[0]!.renderer_revision = 'evidence-renderer.v999';
  state.snapshots[0]!.rendered_plan_json = JSON.stringify({
    ...snapshot.renderedPlan,
    rendererRevision: 'evidence-renderer.v999',
  });
  await assert.rejects(
    repository.getOrCreateManifestForRun(SOURCE_RUN_ID),
    /EVIDENCE_CONTRACT_SNAPSHOT_INVALID/u,
  );
  assert.equal(state.manifests.length, 0);
});

test('manifest repository rejects a changed query plan or snapshot revision', async () => {
  const { repository, draft } = createFixture();
  const changedRecipes = draft.recipes.map((recipe, index) => index === 0
    ? { ...recipe, renderedQuery: 'not-the-captured-query' }
    : recipe);
  await assert.rejects(
    repository.getOrCreateManifest(parseEvidenceManifestDraft({
      ...draft,
      recipes: changedRecipes,
    })),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_CONFLICT',
  );
});

test('historical Manifest lookup stays bound to source run and remains readable after Run retention', async () => {
  const { repository, draft } = createFixture();
  const first = (await repository.getOrCreateManifest(draft)).manifest;
  const nextTimeline = {
    ...draft.timeline,
    cleanupFinishedAt: '2026-10-09T06:01:00.000Z',
    terminalAt: '2026-10-09T06:01:00.000Z',
  };
  const second = (await repository.getOrCreateManifest(parseEvidenceManifestDraft({
    ...draft,
    timeline: nextTimeline,
    timelineHash: getEvidenceTimelineHash(nextTimeline),
  }))).manifest;

  assert.equal((await repository.getManifest(SOURCE_RUN_ID, first.manifestId))?.manifestRevision, 1);
  assert.equal((await repository.getLatestManifest(SOURCE_RUN_ID))?.manifestId, second.manifestId);
  assert.deepEqual(
    (await repository.listManifests(SOURCE_RUN_ID, { beforeRevision: 2 })).map(({ manifestId }) => manifestId),
    [first.manifestId],
  );
  const immutableCoreHash = first.manifestHash;
  const immutableRecipes = first.recipes;

  const state = (repository as unknown as { pool: FakePool }).pool.state;
  const connection = await (repository as unknown as { pool: FakePool }).pool.getConnection();
  await connection.beginTransaction();
  await repository.markSourceRunRetained(connection as unknown as PoolConnection, SOURCE_RUN_ID);
  await connection.commit();
  connection.release();
  assert.equal(state.manifests.every((row) => row.source_run_retained === 0), true);
  const historyReadStart = state.queries.length;
  const retained = await repository.getManifest(SOURCE_RUN_ID, first.manifestId);
  const historyReadQueries = state.queries.slice(historyReadStart);
  assert.ok(historyReadQueries.length > 0);
  assert.equal(historyReadQueries.some((sql) => sql.includes('FROM fault_runs')), false);
  assert.equal(retained?.manifestId, first.manifestId);
  assert.equal(retained?.sourceRunRetained, false);
  assert.equal(retained?.manifestHash, immutableCoreHash);
  assert.deepEqual(retained?.recipes, immutableRecipes);
});

test('repository rejects malformed persisted Manifest JSON instead of returning a partial record', async () => {
  const { repository, state, draft } = createFixture();
  const { manifest } = await repository.getOrCreateManifest(draft);
  state.manifests[0]!.windows_json = '{"invalid":';
  await assert.rejects(
    repository.getManifest(SOURCE_RUN_ID, manifest.manifestId),
    /EVIDENCE_JSON_INVALID/u,
  );
});

test('report attempt retry uses the same run-scoped idempotency record and stores only status items', async () => {
  const { repository, state, draft } = createFixture();
  const { manifest } = await repository.getOrCreateManifest(draft);
  const input = {
    sourceFaultRunId: SOURCE_RUN_ID,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-attempt-001',
    totalTimeoutMs: 1000,
    operatorId: 7,
    correlationId: 'trace-1',
  };
  const created = await repository.createReportAttempt(input);
  const replay = await repository.createReportAttempt(input);
  assert.equal(created.created, true);
  assert.equal(replay.created, false);
  assert.equal(created.attempt.attemptId, replay.attempt.attemptId);
  assert.equal(created.attempt.deadlineAt, '2026-10-09T06:00:06.000Z');
  assert.equal(state.audits.length, 1);
  await assert.rejects(
    repository.getReportAttemptByIdempotencyKey({
      sourceFaultRunId: SOURCE_RUN_ID,
      manifestId: manifest.manifestId,
      manifestHash: 'b'.repeat(64),
      idempotencyKey: input.idempotencyKey,
    }),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_IDEMPOTENCY_KEY_REUSED',
  );
  const activeP99Recipe = draft.recipes.find((recipe) =>
    recipe.source === 'PROMETHEUS' && recipe.window === 'active' && recipe.template === 'HTTP_P99');
  assert.ok(activeP99Recipe);

  const revisedTimeline = {
    ...draft.timeline,
    cleanupFinishedAt: '2026-10-09T06:01:00.000Z',
    terminalAt: '2026-10-09T06:01:00.000Z',
  };
  const revisedManifest = await repository.getOrCreateManifest(parseEvidenceManifestDraft({
    ...draft,
    timeline: revisedTimeline,
    timelineHash: getEvidenceTimelineHash(revisedTimeline),
  }));
  await assert.rejects(
    repository.createReportAttempt({
      ...input,
      manifestId: revisedManifest.manifest.manifestId,
      manifestHash: revisedManifest.manifest.manifestHash,
    }),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_IDEMPOTENCY_KEY_REUSED',
  );
  const oldManifestReplay = await repository.createReportAttempt(input);
  assert.equal(oldManifestReplay.created, false);
  assert.equal(oldManifestReplay.attempt.attemptId, created.attempt.attemptId);

  state.failNextAttemptItemInsert = true;
  await assert.rejects(
    repository.completeReportAttempt({
      attemptId: created.attempt.attemptId,
      state: 'COMPLETED',
      evidenceStatus: 'PARTIAL',
      failureCode: null,
      totalDurationMs: 100,
      items: [{
        recipeId: activeP99Recipe.recipeId,
        source: 'PROMETHEUS',
        window: 'active',
        availability: 'AVAILABLE',
        coverage: 'FULL',
        predicateOutcome: 'MET',
        reasonCode: null,
        durationMs: 10,
        queriedAt: '2026-10-09T06:00:00.100Z',
        executedStartAt: '2026-10-09T05:55:00.000Z',
        executedEndAt: '2026-10-09T06:00:00.000Z',
      }],
    }),
    /FAKE_ATTEMPT_ITEM_WRITE_FAILED/,
  );
  assert.equal(state.attempts[0]?.state, 'RUNNING');
  assert.equal(state.attemptItems.length, 0);
  state.failNextAttemptItemInsert = false;

  await assert.rejects(
    repository.completeReportAttempt({
      attemptId: created.attempt.attemptId,
      state: 'COMPLETED',
      evidenceStatus: 'PARTIAL',
      failureCode: null,
      totalDurationMs: 100,
      items: [{
        recipeId: 'unknown-recipe',
        source: 'PROMETHEUS',
        window: 'active',
        availability: 'AVAILABLE',
        coverage: 'FULL',
        predicateOutcome: 'MET',
        reasonCode: null,
        durationMs: 10,
        queriedAt: '2026-10-09T06:00:00.100Z',
        executedStartAt: '2026-10-09T05:55:00.000Z',
        executedEndAt: '2026-10-09T06:00:00.000Z',
      }],
    }),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_REPOSITORY_INVALID_INPUT',
  );
  assert.equal(state.attempts[0]?.state, 'RUNNING');
  assert.equal(state.attemptItems.length, 0);

  const completed = await repository.completeReportAttempt({
    attemptId: created.attempt.attemptId,
    state: 'COMPLETED',
    evidenceStatus: 'PARTIAL',
    failureCode: null,
    totalDurationMs: 100,
    items: [{
      recipeId: activeP99Recipe.recipeId,
      source: 'PROMETHEUS',
      window: 'active',
      availability: 'AVAILABLE',
      coverage: 'FULL',
      predicateOutcome: 'MET',
      reasonCode: null,
      durationMs: 10,
      queriedAt: '2026-10-09T06:00:00.100Z',
      executedStartAt: '2026-10-09T05:55:00.000Z',
      executedEndAt: '2026-10-09T06:00:00.000Z',
    }],
  });
  assert.equal(completed.state, 'COMPLETED');
  assert.equal(state.attemptItems.length, 1);
  assert.deepEqual(Object.keys(state.attemptItems[0]!).sort(), [
    'attempt_id', 'availability', 'coverage', 'duration_ms', 'executed_end_at',
    'executed_start_at', 'predicate_outcome', 'queried_at', 'reason_code',
    'recipe_id', 'source', 'window_name',
  ]);
  assert.equal('summary_json' in state.attemptItems[0]!, false);
  assert.equal('queryResult' in state.attemptItems[0]!, false);
  await assert.rejects(
    repository.createReportAttempt({ ...input, manifestHash: 'b'.repeat(64) }),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_IDEMPOTENCY_KEY_REUSED',
  );
});

test('expired RUNNING attempts settle lazily with CAS and do not replay a query', async () => {
  const { repository, state, draft } = createFixture();
  const { manifest } = await repository.getOrCreateManifest(draft);
  const created = await repository.createReportAttempt({
    sourceFaultRunId: SOURCE_RUN_ID,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-attempt-expired',
    totalTimeoutMs: 1000,
    operatorId: 7,
    correlationId: null,
  });
  state.now += 7000;
  const expiredReplay = await repository.getReportAttemptByIdempotencyKey({
    sourceFaultRunId: SOURCE_RUN_ID,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-attempt-expired',
  });
  assert.equal(expiredReplay?.attemptId, created.attempt.attemptId);
  assert.equal(expiredReplay?.state, 'FAILED');
  assert.equal(expiredReplay?.failureCode, 'EXECUTION_INTERRUPTED');
  const history = await repository.listReportAttempts(SOURCE_RUN_ID);
  assert.equal(history[0]?.state, 'FAILED');
  assert.equal(history[0]?.failureCode, 'EXECUTION_INTERRUPTED');
  assert.equal(state.attemptItems.length, 0);
  assert.equal(state.audits[0]?.result, 'FAILURE');
  await assert.rejects(
    repository.completeReportAttempt({
      attemptId: created.attempt.attemptId,
      state: 'COMPLETED',
      evidenceStatus: 'AVAILABLE',
      failureCode: null,
      totalDurationMs: 100,
      items: [],
    }),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_ATTEMPT_NOT_RUNNING',
  );
  assert.equal(await repository.settleExpiredAttempts(SOURCE_RUN_ID), 0);
  const replay = await repository.createReportAttempt({
    sourceFaultRunId: SOURCE_RUN_ID,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-attempt-expired',
    totalTimeoutMs: 1000,
    operatorId: 7,
    correlationId: null,
  });
  assert.equal(replay.created, false);
  assert.equal(replay.attempt.attemptId, created.attempt.attemptId);
});

test('note retry is idempotent and note plus audit commit together without copying its body to audit', async () => {
  const { repository, state, draft } = createFixture();
  const { manifest } = await repository.getOrCreateManifest(draft);
  const input = {
    sourceFaultRunId: SOURCE_RUN_ID,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-note-001',
    operatorId: 7,
    correlationId: null,
    text: 'Inspect the recovery window',
  };
  const first = await repository.createOperatorNote(input);
  const replay = await repository.createOperatorNote(input);
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.note.noteId, first.note.noteId);
  assert.equal(state.notes.length, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(JSON.stringify(state.audits).includes(input.text), false);
  assert.deepEqual(Object.keys(state.audits[0]!).sort(), [
    'action', 'correlation_id', 'id', 'operator_id', 'parameter_hash', 'result', 'target',
  ]);
  await assert.rejects(
    repository.createOperatorNote({ ...input, text: 'Different note body' }),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_IDEMPOTENCY_KEY_REUSED',
  );
  assert.equal(state.notes.length, 1);
  assert.equal(state.audits.length, 1);

  const revisedTimeline = {
    ...draft.timeline,
    cleanupFinishedAt: '2026-10-09T06:01:00.000Z',
    terminalAt: '2026-10-09T06:01:00.000Z',
  };
  const revisedManifest = await repository.getOrCreateManifest(parseEvidenceManifestDraft({
    ...draft,
    timeline: revisedTimeline,
    timelineHash: getEvidenceTimelineHash(revisedTimeline),
  }));
  await assert.rejects(
    repository.createOperatorNote({
      ...input,
      manifestId: revisedManifest.manifest.manifestId,
      manifestHash: revisedManifest.manifest.manifestHash,
    }),
    (error: unknown) => error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_IDEMPOTENCY_KEY_REUSED',
  );
  assert.equal(state.notes.length, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(state.queries.some((sql) => sql.startsWith('UPDATE fault_runs')), false);

});

test('audit insert and completion failures propagate and roll back related Evidence state', async () => {
  const { repository, state, draft } = createFixture();
  const { manifest } = await repository.getOrCreateManifest(draft);
  const noteInput = {
    sourceFaultRunId: SOURCE_RUN_ID,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-note-audit-failure',
    operatorId: 7,
    correlationId: null,
    text: 'A safe operator note.',
  };

  state.failNextAuditInsert = true;
  await assert.rejects(repository.createOperatorNote(noteInput), /FAKE_AUDIT_INSERT_FAILED/u);
  assert.equal(state.notes.length, 0);
  assert.equal(state.audits.length, 0);
  state.failNextAuditInsert = false;

  state.failNextAuditInsert = true;
  await assert.rejects(
    repository.createReportAttempt({
      sourceFaultRunId: SOURCE_RUN_ID,
      manifestId: manifest.manifestId,
      manifestHash: manifest.manifestHash,
      idempotencyKey: 'evidence-attempt-audit-failure',
      totalTimeoutMs: 1000,
      operatorId: 7,
      correlationId: null,
    }),
    /FAKE_AUDIT_INSERT_FAILED/u,
  );
  assert.equal(state.attempts.length, 0);
  assert.equal(state.audits.length, 0);
  state.failNextAuditInsert = false;

  const created = await repository.createReportAttempt({
    sourceFaultRunId: SOURCE_RUN_ID,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-attempt-audit-update-failure',
    totalTimeoutMs: 1000,
    operatorId: 7,
    correlationId: null,
  });
  state.failNextAuditUpdate = true;
  await assert.rejects(
    repository.completeReportAttempt({
      attemptId: created.attempt.attemptId,
      state: 'FAILED',
      evidenceStatus: null,
      failureCode: 'EXECUTION_CANCELLED',
      totalDurationMs: 100,
      items: [],
    }),
    /FAKE_AUDIT_UPDATE_FAILED/u,
  );
  assert.equal(state.attempts[0]?.state, 'RUNNING');
  assert.equal(state.audits[0]?.result, 'SUCCESS');
  state.failNextAuditUpdate = false;
});

interface FakeState {
  now: number;
  runState: string;
  runScenario: string;
  runContractRevision: string;
  runCreatedAt: string;
  runStartedAt: string | null;
  runStoppedAt: string | null;
  runRecoveryResult: unknown;
  snapshots: Record<string, unknown>[];
  manifests: Record<string, unknown>[];
  events: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  actionTableExists: boolean;
  attempts: Record<string, unknown>[];
  attemptItems: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  audits: Record<string, unknown>[];
  queries: string[];
  nextAuditId: number;
  failNextAttemptItemInsert?: boolean;
  failNextAuditInsert?: boolean;
  failNextAuditUpdate?: boolean;
}

interface FakeRunLock {
  held: boolean;
  waiters: (() => void)[];
}

const fakeRunLocks = new WeakMap<FakeState, FakeRunLock>();

class FakePool {
  constructor(readonly state: FakeState) {}

  async getConnection(): Promise<FakeConnection> {
    return new FakeConnection(this.state);
  }

  async query(sql: string, values: unknown[] = []): Promise<[unknown, unknown]> {
    return new FakeConnection(this.state).query(sql, values);
  }
}

class FakeConnection {
  private backup: FakeState | null = null;
  private releaseRunLock: (() => void) | null = null;

  constructor(private readonly state: FakeState) {}

  async beginTransaction(): Promise<void> {
    this.backup = structuredClone(this.state);
  }

  async commit(): Promise<void> {
    this.backup = null;
    this.releaseRunLock?.();
    this.releaseRunLock = null;
  }

  async rollback(): Promise<void> {
    if (!this.backup) return;
    Object.assign(this.state, this.backup);
    this.backup = null;
    this.releaseRunLock?.();
    this.releaseRunLock = null;
  }

  release(): void {
    this.releaseRunLock?.();
    this.releaseRunLock = null;
  }

  async query(sql: string, values: unknown[] = []): Promise<[unknown, unknown]> {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    this.state.queries.push(normalized);
    if (normalized.includes('FROM fault_runs') && normalized.includes('FOR UPDATE')) {
      this.releaseRunLock = await acquireFakeRunLock(this.state);
    }
    if (normalized.includes('FROM evidence_contract_snapshots')) {
      const [sourceRunId] = values;
      return [[...this.state.snapshots.filter((row) => row.source_fault_run_id === sourceRunId)], []];
    }
    if (normalized.includes('FROM fault_run_events')) {
      return [[...this.state.events], []];
    }
    if (normalized.includes('information_schema.tables')) {
      return [this.state.actionTableExists ? [{ table_name: 'fault_run_actions' }] : [], []];
    }
    if (normalized.includes('FROM fault_run_actions')) {
      return [[...this.state.actions], []];
    }
    if (normalized.includes('MAX(manifest_revision)')) {
      const revisions = this.state.manifests
        .filter((row) => row.source_fault_run_id === values[0])
        .map((row) => Number(row.manifest_revision));
      return [[{ max_revision: Math.max(0, ...revisions) }], []];
    }
    if (normalized.includes('FROM fault_runs')) {
      if (values[0] !== SOURCE_RUN_ID) return [[], []];
      const snapshot = this.state.snapshots.find((row) => row.source_fault_run_id === SOURCE_RUN_ID);
      return [[{
          fault_run_id: SOURCE_RUN_ID,
          state: this.state.runState,
          scenario: this.state.runScenario ?? snapshot?.scenario,
          contract_revision: this.state.runContractRevision ?? snapshot?.contract_revision,
          ...(normalized.includes('created_at') ? {
            created_at: this.state.runCreatedAt,
            started_at: this.state.runStartedAt,
            stopped_at: this.state.runStoppedAt,
            recovery_result: this.state.runRecoveryResult,
          } : {}),
      }], []];
    }
    if (normalized.includes('FROM evidence_query_manifests')) {
      const rows = this.state.manifests
        .filter((row) => this.matchManifest(row, normalized, values))
        .map((row) => {
          const snapshot = this.state.snapshots.find((entry) => entry.snapshot_id === row.snapshot_id);
          return normalized.includes('JOIN evidence_contract_snapshots')
            ? { ...row, contract_hash: snapshot?.contract_hash, rendered_plan_hash: snapshot?.rendered_plan_hash }
            : row;
        });
      if (normalized.includes('ORDER BY m.manifest_revision DESC')) {
        rows.sort((left, right) => Number(right.manifest_revision) - Number(left.manifest_revision));
      }
      return [rows, []];
    }
    if (normalized.includes('FROM evidence_query_attempts')) {
      return [this.state.attempts.filter((row) => this.matchAttempt(row, normalized, values)), []];
    }
    if (normalized.includes('FROM evidence_operator_notes')) {
      return [this.state.notes.filter((row) => this.matchNote(row, normalized, values)), []];
    }
    throw new Error(`UNEXPECTED_FAKE_QUERY:${normalized}`);
  }

  async execute(sql: string, values: unknown[] = []): Promise<[unknown, unknown]> {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    this.state.queries.push(normalized);
    if (normalized.startsWith('INSERT INTO operator_audit_logs')) {
      if (this.state.failNextAuditInsert === true) throw new Error('FAKE_AUDIT_INSERT_FAILED');
      const id = this.state.nextAuditId++;
      this.state.audits.push({
        id, operator_id: values[0], action: values[1], target: values[2],
        parameter_hash: values[3], result: values[4], correlation_id: values[5],
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO evidence_contract_snapshots')) {
      const [id, runId, scenario, contractRevision, contractHash, contractJson,
        rendererRevision, evaluationRevision, renderedPlanHash, renderedPlanJson] = values;
      this.state.snapshots.push({
        snapshot_id: id,
        source_fault_run_id: runId,
        scenario,
        contract_schema_version: 'evidence-contract.v1',
        contract_revision: contractRevision,
        contract_hash: contractHash,
        contract_json: contractJson,
        renderer_revision: rendererRevision,
        evaluation_revision: evaluationRevision,
        rendered_plan_hash: renderedPlanHash,
        rendered_plan_json: renderedPlanJson,
        created_at: dbTimestamp(this.state.now),
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO evidence_query_manifests')) {
      const [id, snapshotId, runId, scenario, schemaVersion, contractRevision,
        revision, timelineHash, manifestHash, timeline, windows, recipes, limitations] = values;
      this.state.manifests.push({
        manifest_id: id, snapshot_id: snapshotId, source_fault_run_id: runId, scenario,
        manifest_schema_version: schemaVersion, contract_revision: contractRevision,
        manifest_revision: revision, timeline_hash: timelineHash, manifest_hash: manifestHash,
        timeline_json: timeline, windows_json: windows, recipes_json: recipes,
        limitations_json: limitations, source_run_retained: 1, materialized_at: dbTimestamp(this.state.now),
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('UPDATE evidence_query_manifests')) {
      const [sourceRunId] = values;
      let affectedRows = 0;
      for (const manifest of this.state.manifests) {
        if (manifest.source_fault_run_id === sourceRunId && manifest.source_run_retained === 1) {
          manifest.source_run_retained = 0;
          affectedRows += 1;
        }
      }
      return [{ affectedRows }, []];
    }
    if (normalized.startsWith('INSERT INTO evidence_query_attempts')) {
      const [id, manifestId, runId, key, requestHash, auditId, deadlineMicroseconds] = values;
      this.state.attempts.push({
        attempt_id: id, manifest_id: manifestId, source_fault_run_id: runId,
        idempotency_key: key, request_hash: requestHash, state: 'RUNNING',
        evidence_status: null, operator_audit_id: auditId,
        requested_at: dbTimestamp(this.state.now),
        deadline_at: dbTimestamp(this.state.now + Number(deadlineMicroseconds) / 1000),
        completed_at: null, total_duration_ms: null, failure_code: null,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO evidence_query_attempt_items')) {
      if (this.state.failNextAttemptItemInsert === true) {
        throw new Error('FAKE_ATTEMPT_ITEM_WRITE_FAILED');
      }
      const [attemptId, recipeId, source, window, availability, coverage,
        predicateOutcome, reasonCode, durationMs, queriedAt, executedStartAt, executedEndAt] = values;
      this.state.attemptItems.push({
        attempt_id: attemptId, recipe_id: recipeId, source, window_name: window,
        availability, coverage, predicate_outcome: predicateOutcome, reason_code: reasonCode,
        duration_ms: durationMs, queried_at: queriedAt,
        executed_start_at: executedStartAt, executed_end_at: executedEndAt,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('UPDATE evidence_query_attempts') && normalized.includes("state = 'FAILED'")) {
      const attempt = this.state.attempts.find((row) => row.attempt_id === values[0]);
      if (!attempt || attempt.state !== 'RUNNING' || timestampMs(attempt.deadline_at) > this.state.now) {
        return [{ affectedRows: 0 }, []];
      }
      attempt.state = 'FAILED';
      attempt.completed_at = dbTimestamp(this.state.now);
      attempt.total_duration_ms = Math.max(0, Math.floor((this.state.now - timestampMs(attempt.requested_at)) / 1000));
      attempt.failure_code = 'EXECUTION_INTERRUPTED';
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('UPDATE evidence_query_attempts')) {
      const attempt = this.state.attempts.find((row) => row.attempt_id === values[4]);
      if (!attempt || attempt.state !== 'RUNNING' || timestampMs(attempt.deadline_at) < this.state.now) {
        return [{ affectedRows: 0 }, []];
      }
      attempt.state = values[0];
      attempt.evidence_status = values[1];
      attempt.completed_at = dbTimestamp(this.state.now);
      attempt.total_duration_ms = values[2];
      attempt.failure_code = values[3];
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('UPDATE operator_audit_logs')) {
      if (this.state.failNextAuditUpdate === true) throw new Error('FAKE_AUDIT_UPDATE_FAILED');
      const audit = this.state.audits.find((row) => row.id === values[1]);
      if (!audit) return [{ affectedRows: 0 }, []];
      audit.result = values[0];
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith('INSERT INTO evidence_operator_notes')) {
      const [id, manifestId, runId, key, requestHash, auditId, text] = values;
      this.state.notes.push({
        note_id: id, manifest_id: manifestId, source_fault_run_id: runId,
        idempotency_key: key, request_hash: requestHash, operator_audit_id: auditId,
        note_text: text, created_at: dbTimestamp(this.state.now),
      });
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`UNEXPECTED_FAKE_EXECUTE:${normalized}`);
  }

  private matchManifest(row: Record<string, unknown>, sql: string, values: unknown[]): boolean {
    if (!sql.includes('source_fault_run_id = ?')) {
      return sql.includes('manifest_id = ?') && row.manifest_id === values[0];
    }
    if (row.source_fault_run_id !== values[0]) return false;
    if (sql.includes('timeline_hash = ?')) return row.timeline_hash === values[1];
    if (sql.includes('manifest_id = ?')) return row.manifest_id === (values.length === 1 ? values[0] : values[1]);
    if (sql.includes('manifest_revision < ?')) return Number(row.manifest_revision) < Number(values[1]);
    return true;
  }

  private matchAttempt(row: Record<string, unknown>, sql: string, values: unknown[]): boolean {
    if (sql.includes('idempotency_key = ?')) {
      return row.source_fault_run_id === values[0] && row.idempotency_key === values[1];
    }
    if (sql.includes("state = 'RUNNING'")) {
      return row.source_fault_run_id === values[0] && row.state === 'RUNNING'
        && timestampMs(row.deadline_at) <= this.state.now;
    }
    if (sql.includes('attempt_id = ?')) return row.attempt_id === values[0];
    if (sql.includes('source_fault_run_id = ?')) return row.source_fault_run_id === values[0];
    return false;
  }

  private matchNote(row: Record<string, unknown>, sql: string, values: unknown[]): boolean {
    if (sql.includes('idempotency_key = ?')) {
      return row.source_fault_run_id === values[0] && row.idempotency_key === values[1];
    }
    if (sql.includes('note_id = ?')) return row.note_id === values[0];
    return sql.includes('source_fault_run_id = ?') && row.source_fault_run_id === values[0];
  }
}

async function acquireFakeRunLock(state: FakeState): Promise<() => void> {
  let lock = fakeRunLocks.get(state);
  if (!lock) {
    lock = { held: false, waiters: [] };
    fakeRunLocks.set(state, lock);
  }
  if (lock.held) await new Promise<void>((resolve) => lock!.waiters.push(resolve));
  else lock.held = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = lock!.waiters.shift();
    if (next) next();
    else lock!.held = false;
  };
}

function createFixture(scenario?: FaultRunScenario) {
  const definition = scenario === undefined
    ? listScenarioDefinitions()[0]!
    : listScenarioDefinitions().find((candidate) => candidate.scenario === scenario)!;
  const contract = resolveScenarioContract(definition);
  const plan = makePlan(contract.evidence.recipes.map(renderRecipe));
  const snapshot = createEvidenceCaptureSnapshot(
    getScenarioContractRevision(contract), contract.evidence, plan,
  );
  const timeline = {
    createdAt: '2026-10-09T05:54:00.000Z',
    prepareStartedAt: '2026-10-09T05:54:01.000Z',
    activeAt: '2026-10-09T05:55:00.000Z',
    stopRequestedAt: '2026-10-09T06:00:00.000Z',
    recoveryStartedAt: '2026-10-09T06:00:01.000Z',
    recoveredAt: '2026-10-09T06:00:02.000Z',
    cleanupFinishedAt: null,
    terminalAt: '2026-10-09T06:00:02.000Z',
    terminalState: 'STOPPED' as const,
  };
  const windows = (['baseline', 'active', 'recovery', 'cleanup'] as const).map((name) => ({
    name, state: 'READY' as const, canonicalStartAt: '2026-10-09T05:55:00.000Z',
    canonicalEndAt: '2026-10-09T06:00:00.000Z', reasonCode: null,
  }));
  const draft = parseEvidenceManifestDraft({
    manifestSchemaVersion: 'evidence-manifest.v1',
    snapshotId: SNAPSHOT_ID,
    sourceFaultRunId: SOURCE_RUN_ID,
    scenario: definition.scenario,
    contractRevision: snapshot.contractRevision,
    contractHash: snapshot.contractHash,
    renderedPlanHash: snapshot.renderedPlanHash,
    timelineHash: getEvidenceTimelineHash(timeline),
    timeline, windows, recipes: plan.recipes, limitations: [],
  });
  const state: FakeState = {
    now: NOW,
    runState: 'STOPPED',
    runScenario: definition.scenario,
    runContractRevision: snapshot.contractRevision,
    runCreatedAt: dbTimestamp(Date.parse(timeline.createdAt)),
    runStartedAt: dbTimestamp(Date.parse(timeline.activeAt)),
    runStoppedAt: dbTimestamp(Date.parse(timeline.terminalAt)),
    runRecoveryResult: { stopped: true },
    snapshots: [{
      snapshot_id: SNAPSHOT_ID, source_fault_run_id: SOURCE_RUN_ID,
      scenario: definition.scenario, contract_schema_version: 'evidence-contract.v1',
      contract_revision: snapshot.contractRevision, contract_hash: snapshot.contractHash,
      contract_json: canonicalizeEvidenceContractPlan(snapshot.evidence),
      renderer_revision: plan.rendererRevision, evaluation_revision: plan.evaluationRevision,
      rendered_plan_hash: snapshot.renderedPlanHash,
      rendered_plan_json: canonicalizeEvidenceRenderedPlan(plan),
      created_at: dbTimestamp(NOW),
    }],
    manifests: [],
    events: [
      { id: 1, fault_run_id: SOURCE_RUN_ID, event_type: 'TARGET_CONFIRMED', payload: {}, created_at: dbTimestamp(Date.parse(timeline.activeAt)) },
      { id: 2, fault_run_id: SOURCE_RUN_ID, event_type: 'STOP_REQUESTED', payload: {}, created_at: dbTimestamp(Date.parse(timeline.stopRequestedAt)) },
      { id: 3, fault_run_id: SOURCE_RUN_ID, event_type: 'RECOVERY_STARTED', payload: {}, created_at: dbTimestamp(Date.parse(timeline.recoveryStartedAt)) },
      { id: 4, fault_run_id: SOURCE_RUN_ID, event_type: 'RECOVERY_COMPLETED', payload: {}, created_at: dbTimestamp(Date.parse(timeline.recoveredAt)) },
    ],
    actions: [{
      action_id: '423e4567-e89b-12d3-a456-426614174006',
      fault_run_id: SOURCE_RUN_ID,
      action_type: 'PREPARE',
      dispatch_started_at: dbTimestamp(Date.parse(timeline.prepareStartedAt)),
      requested_at: dbTimestamp(Date.parse(timeline.prepareStartedAt) - 1000),
    }],
    actionTableExists: true,
    attempts: [],
    attemptItems: [],
    notes: [],
    audits: [],
    queries: [],
    nextAuditId: 1,
  };
  const pool = new FakePool(state);
  const repository = new SqlEvidenceRepository(pool as unknown as Pool, async () => undefined, async () => undefined);
  return { repository, state, draft, snapshot };
}

function makePlan(recipes: RenderedEvidenceRecipe[]): EvidenceRenderedPlan {
  return {
    schemaVersion: 'evidence-rendered-plan.v1',
    rendererRevision: EVIDENCE_RENDERER_REVISION,
    evaluationRevision: EVIDENCE_EVALUATION_REVISION,
    windowLimits: { baseline: 900, active: 3660, recovery: 2100, cleanup: 600 },
    recipes,
  };
}

function renderRecipe(recipe: EvidenceRecipeDefinition): RenderedEvidenceRecipe {
  const isEvent = recipe.source === 'RUN_EVENT';
  const isBusiness = recipe.source === 'BUSINESS_CHECK';
  const aggregation = isEvent ? 'TIMELINE'
    : isBusiness ? 'CURRENT_BOOLEAN'
      : recipe.window === 'baseline' ? 'BASELINE_SUMMARY'
        : recipe.source === 'PROMETHEUS'
          ? recipe.window === 'active' ? 'ACTIVE_ANY_SAMPLE' : 'RECOVERY_ALL_SAMPLES'
          : recipe.source === 'LOKI' ? 'LOKI_BUCKET_SERIES' : 'TRACE_MATCH_COUNT';
  const valueUnit = isEvent ? 'timeline'
    : isBusiness ? 'boolean'
      : recipe.source === 'TEMPO' || recipe.source === 'LOKI' ? 'count'
        : recipe.template === 'HTTP_P99' ? 'seconds'
          : recipe.template === 'HTTP_RATE' || recipe.template === 'PAYMENT_TIMEOUT_RATE'
            || recipe.template === 'MYSQL_SLOW_QUERY_RATE' ? 'count_per_second'
            : recipe.template === 'NODE_FILESYSTEM_GROWTH_RATE' ? 'bytes_per_second' : 'ratio';
  return {
    recipeId: recipe.id, source: recipe.source, window: recipe.window,
    observationMode: recipe.observationMode, required: recipe.required,     template: recipe.template,
    scope: recipe.scope,
    scopeMode: recipe.source === 'LOKI'
      || recipe.source === 'TEMPO' && recipe.scope.fixedLabels !== undefined
      ? 'SERVICE_ONLY'
      : 'DECLARED', predicate: recipe.predicate, projection: recipe.projection,
    renderedQuery: isEvent || isBusiness ? null : `fixed:${recipe.template}`,
    businessCheckId: isBusiness ? recipe.template as 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT' : null,
    valueUnit, lookbackSec: 0, aggregation, baselineForRecipeId: null,
  };
}

function dbTimestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace('T', ' ').replace('Z', '');
}

function timestampMs(value: unknown): number {
  return new Date(String(value).replace(' ', 'T') + (String(value).includes('T') ? '' : 'Z')).getTime();
}
