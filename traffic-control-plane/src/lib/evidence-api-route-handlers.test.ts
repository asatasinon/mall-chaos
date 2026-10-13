import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { createEvidenceManifestDraft } from './evidence-manifest-materializer';
import {
  createEvidenceCaptureSnapshot,
  getEvidenceManifestHash,
  parseEvidenceManifest,
  parseEvidenceStoredContractSnapshot,
  type EvidenceAttemptItemRecord,
  type EvidenceAttemptRecord,
  type EvidenceManifestRecord,
  EvidenceTypeError,
} from './evidence-types';
import { EvidenceRepositoryError } from './evidence-repository';
import {
  handleEvidenceLatestManifest,
  handleEvidenceManifestDetail,
  handleEvidenceManifestList,
  handleEvidenceNoteHistory,
  handleEvidenceNotePost,
  handleEvidenceReportHistory,
  handleEvidenceReportPost,
  type EvidenceApiRouteDependencies,
} from './evidence-api-route-handlers';
import { EvidenceReportServiceError } from './evidence-report-service';
import { listScenarioDefinitions } from './fault-run-catalog';
import { getScenarioContractRevision, resolveScenarioContract } from './scenario-contract';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';
import { readEvidenceQueryEnabled } from './evidence-web-config';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const MANIFEST_ID = '323e4567-e89b-12d3-a456-426614174002';
const LATEST_MANIFEST_ID = '523e4567-e89b-12d3-a456-426614174004';
const ATTEMPT_ID = '423e4567-e89b-12d3-a456-426614174003';
const NOW = '2026-10-09T06:00:00.000Z';

test('metadata API gate reads only its Web flag and is independent of provider config', () => {
  assert.equal(readEvidenceQueryEnabled({
    EVIDENCE_QUERY_ENABLED: 'true',
    EVIDENCE_PROMETHEUS_BASE_URL: 'not-a-valid-origin',
  }), true);
  assert.equal(readEvidenceQueryEnabled({}), false);
});

test('latest Manifest materializes a terminal capture and returns no-store metadata', async () => {
  const manifest = fixtureManifest();
  let materializeCalls = 0;
  const dependencies = createDependencies({
    repository: createRepository({
      getLatestManifest: async () => null,
      getOrCreateManifestForRun: async () => {
        materializeCalls += 1;
        return { manifest, created: true };
      },
    }),
  });

  const response = await handleEvidenceLatestManifest(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence`),
    RUN_ID,
    dependencies,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(materializeCalls, 1);
  assert.equal(body.data.manifestId, MANIFEST_ID);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('latest Manifest distinguishes legacy and retained source runs without source queries', async () => {
  const legacy = createDependencies({
    repository: createRepository({
      getLatestManifest: async () => null,
      getOrCreateManifestForRun: async () => {
        throw new EvidenceRepositoryError('EVIDENCE_CONTRACT_SNAPSHOT_NOT_FOUND');
      },
    }),
  });
  const legacyResponse = await handleEvidenceLatestManifest(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence`),
    RUN_ID,
    legacy,
  );
  assert.deepEqual((await legacyResponse.json()).data, {
    status: 'EVIDENCE_UNAVAILABLE',
    reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE',
    manifest: null,
  });

  let materializeCalls = 0;
  const retainedManifest = fixtureManifest(false);
  const retained = createDependencies({
    repository: createRepository({
      getLatestManifest: async () => retainedManifest,
      getOrCreateManifestForRun: async () => {
        materializeCalls += 1;
        return { manifest: retainedManifest, created: false };
      },
    }),
  });
  const retainedResponse = await handleEvidenceLatestManifest(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence`),
    RUN_ID,
    retained,
  );
  assert.equal((await retainedResponse.json()).data.sourceRunRetained, false);
  assert.equal(materializeCalls, 0);
});

test('Manifest list enforces its cursor contract and detail binds ownership to source Run', async () => {
  const manifest = fixtureManifest();
  let listOptions: unknown;
  let detailArgs: unknown[] = [];
  const dependencies = createDependencies({
    repository: createRepository({
      listManifests: async (_runId, options) => {
        listOptions = options;
        return [manifest];
      },
      getManifest: async (runId, manifestId) => {
        detailArgs = [runId, manifestId];
        return manifest;
      },
    }),
  });

  const listResponse = await handleEvidenceManifestList(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence/manifests?limit=12&beforeRevision=3`),
    RUN_ID,
    dependencies,
  );
  assert.equal(listResponse.status, 200);
  assert.deepEqual(listOptions, { limit: 12, beforeRevision: 3 });
  const invalidList = await handleEvidenceManifestList(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence/manifests?limit=1000`),
    RUN_ID,
    dependencies,
  );
  assert.equal(invalidList.status, 400);

  const detail = await handleEvidenceManifestDetail(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence/manifests/${MANIFEST_ID}`),
    RUN_ID,
    MANIFEST_ID,
    dependencies,
  );
  assert.equal(detail.status, 200);
  assert.deepEqual(detailArgs, [RUN_ID, MANIFEST_ID]);
});

test('report history returns only attempt and item metadata after lazy settlement', async () => {
  const manifest = fixtureManifest();
  const attempt = fixtureAttempt(manifest);
  let historyOptions: unknown;
  const dependencies = createDependencies({
    repository: createRepository({
      listReportAttempts: async (_runId, options) => {
        historyOptions = options;
        return [attempt];
      },
      getManifest: async () => manifest,
      listReportAttemptItems: async () => [fixtureItem()],
    }),
  });

  const response = await handleEvidenceReportHistory(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence/reports?limit=5&beforeAt=${encodeURIComponent(NOW)}&beforeId=${ATTEMPT_ID}`),
    RUN_ID,
    dependencies,
  );
  const data = (await response.json()).data;

  assert.equal(response.status, 200);
  assert.deepEqual(historyOptions, { limit: 5, beforeAt: NOW, beforeId: ATTEMPT_ID });
  assert.equal(data.reports[0].manifestRevision, 1);
  assert.equal(data.reports[0].items[0].predicateOutcome, 'MET');
  assert.equal('numericSummary' in data.reports[0], false);
  assert.equal('providerResponse' in data.reports[0].items[0], false);
});

test('note history uses the bounded cursor and only returns note metadata', async () => {
  const manifest = fixtureManifest();
  let historyOptions: unknown;
  const dependencies = createDependencies({
    repository: createRepository({
      listOperatorNotes: async (_runId, options) => {
        historyOptions = options;
        return [fixtureNote(manifest)];
      },
    }),
  });

  const response = await handleEvidenceNoteHistory(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence/notes?limit=4&beforeAt=${encodeURIComponent(NOW)}&beforeId=${ATTEMPT_ID}`),
    RUN_ID,
    dependencies,
  );
  const data = (await response.json()).data;

  assert.equal(response.status, 200);
  assert.deepEqual(historyOptions, { limit: 4, beforeAt: NOW, beforeId: ATTEMPT_ID });
  assert.equal(data.notes[0].text, 'Recovery looked stable.');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('note POST normalizes line endings, preserves idempotency, and rejects unsafe content without echo', async () => {
  const manifest = fixtureManifest();
  let serviceInput: unknown;
  let serviceCalls = 0;
  const dependencies = createDependencies({
    repository: createRepository({
      createOperatorNote: async (input) => {
        serviceInput = input;
        serviceCalls += 1;
        return { note: fixtureNote(manifest), created: true };
      },
    }),
  });

  const accepted = await handleEvidenceNotePost(
    noteRequest(manifest, 'evidence-note-request-001', 'Recovery looked stable.\r\nNo follow-up.'),
    RUN_ID,
    dependencies,
  );
  assert.equal(accepted.status, 200);
  assert.deepEqual(serviceInput, {
    sourceFaultRunId: RUN_ID,
    manifestId: MANIFEST_ID,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-note-request-001',
    text: 'Recovery looked stable.\nNo follow-up.',
    operatorId: 7,
    correlationId: 'trace-route',
  });
  assert.equal(accepted.headers.get('cache-control'), 'no-store');

  for (const [text, reasonCode] of [
    ['<script>private</script>', 'EVIDENCE_NOTE_HTML_NOT_ALLOWED'],
    ['Authorization: Bearer abcdefghijklmnop', 'EVIDENCE_NOTE_CREDENTIAL_NOT_ALLOWED'],
    ['{"traceId":"private"}', 'EVIDENCE_NOTE_EXPORT_NOT_ALLOWED'],
  ] as const) {
    const rejected = await handleEvidenceNotePost(
      noteRequest(manifest, 'evidence-note-request-002', text),
      RUN_ID,
      dependencies,
    );
    assert.equal(rejected.status, 400);
    const rejectedBody = await rejected.json();
    assert.equal(rejectedBody.message, reasonCode);
    assert.equal(serviceCalls, 1);
    assert.equal(JSON.stringify(rejectedBody).includes(text), false);
  }

  const csrfFailure = await handleEvidenceNotePost(
    noteRequest(manifest, 'evidence-note-request-003', 'A safe note.'),
    RUN_ID,
    createDependencies({ csrfValid: () => false }),
  );
  assert.equal(csrfFailure.status, 403);

  const keyConflict = await handleEvidenceNotePost(
    noteRequest(manifest, 'evidence-note-request-004', 'A different safe note.'),
    RUN_ID,
    createDependencies({
      repository: createRepository({
        createOperatorNote: async () => {
          throw new EvidenceRepositoryError('EVIDENCE_IDEMPOTENCY_KEY_REUSED');
        },
      }),
    }),
  );
  assert.equal(keyConflict.status, 409);
  assert.equal((await keyConflict.json()).message, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(keyConflict.headers.get('cache-control'), 'no-store');
});

test('report POST executes the explicitly selected older revision and validates CSRF and body', async () => {
  const manifest = fixtureManifest();
  const latestManifest: EvidenceManifestRecord = {
    ...manifest,
    manifestId: LATEST_MANIFEST_ID,
    manifestRevision: manifest.manifestRevision + 1,
    manifestHash: 'c'.repeat(64),
  };
  let serviceCalls = 0;
  let serviceInput: unknown;
  let latestReads = 0;
  const dependencies = createDependencies({
    repository: createRepository({
      getLatestManifest: async () => {
        latestReads += 1;
        return latestManifest;
      },
      getOrCreateManifestForRun: async () => {
        throw new Error('explicit report selection must not materialize latest');
      },
    }),
    reportService: {
      async executeAttempt(input) {
        serviceCalls += 1;
        serviceInput = input;
        return { attempt: fixtureAttempt(manifest), replayed: false, report: null };
      },
    },
  });
  const request = reportRequest(manifest, 'evidence-report-request-001');
  const response = await handleEvidenceReportPost(request, RUN_ID, dependencies);

  assert.equal(response.status, 200);
  assert.equal(serviceCalls, 1);
  assert.equal(latestReads, 0);
  assert.deepEqual(serviceInput, {
    sourceFaultRunId: RUN_ID,
    manifestId: MANIFEST_ID,
    manifestHash: manifest.manifestHash,
    idempotencyKey: 'evidence-report-request-001',
    operatorId: 7,
    correlationId: 'trace-route',
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const extraFieldRequest = new NextRequest(`http://localhost/internal/fault-runs/${RUN_ID}/evidence/reports`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-value',
      'X-Idempotency-Key': 'evidence-report-request-002',
    },
    body: JSON.stringify({
      manifestId: MANIFEST_ID,
      manifestHash: manifest.manifestHash,
      confirmed: true,
      query: 'up',
    }),
  });
  assert.equal((await handleEvidenceReportPost(extraFieldRequest, RUN_ID, dependencies)).status, 400);
  assert.equal(serviceCalls, 1);

  const csrfFailure = createDependencies({ csrfValid: () => false });
  const denied = await handleEvidenceReportPost(
    reportRequest(manifest, 'evidence-report-request-003'),
    RUN_ID,
    csrfFailure,
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
});

test('route failures use fixed status codes and no-store headers', async () => {
  const manifest = fixtureManifest();
  const cases: readonly {
    readonly error: Error;
    readonly status: number;
    readonly message: string;
  }[] = [
    {
      error: new EvidenceRepositoryError('EVIDENCE_SOURCE_RUN_NOT_TERMINAL'),
      status: 409,
      message: 'RUN_NOT_TERMINAL',
    },
    {
      error: new EvidenceRepositoryError('EVIDENCE_SOURCE_RUN_NOT_RETAINED'),
      status: 404,
      message: 'FAULT_RUN_NOT_FOUND',
    },
  ];
  for (const entry of cases) {
    const response = await handleEvidenceLatestManifest(
      getRequest(`/internal/fault-runs/${RUN_ID}/evidence`),
      RUN_ID,
      createDependencies({
        repository: createRepository({
          getLatestManifest: async () => null,
          getOrCreateManifestForRun: async () => { throw entry.error; },
        }),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, entry.status);
    assert.equal(body.message, entry.message);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }

  for (const [error, status, message] of [
    [new EvidenceReportServiceError('EVIDENCE_REPORT_MANIFEST_INVALID'), 422, 'INVALID_QUERY'],
    [new EvidenceReportServiceError('EVIDENCE_REPORT_BUSY'), 429, 'EVIDENCE_QUERY_BUSY'],
    [new EvidenceRepositoryError('EVIDENCE_IDEMPOTENCY_KEY_REUSED'), 409, 'IDEMPOTENCY_KEY_REUSED'],
  ] as const) {
    const response = await handleEvidenceReportPost(
      reportRequest(manifest, 'evidence-report-status-001'),
      RUN_ID,
      createDependencies({
        reportService: {
          async executeAttempt() { throw error; },
        },
      }),
    );
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.message, message);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }

  const badId = await handleEvidenceLatestManifest(
    getRequest('/internal/fault-runs/not-a-uuid/evidence'),
    'not-a-uuid',
  );
  assert.equal(badId.status, 400);
  assert.equal(badId.headers.get('cache-control'), 'no-store');

  const missingOwnership = await handleEvidenceManifestDetail(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence/manifests/${MANIFEST_ID}`),
    RUN_ID,
    MANIFEST_ID,
    createDependencies({
      repository: createRepository({ getManifest: async () => null }),
    }),
  );
  assert.equal(missingOwnership.status, 404);
  assert.equal(missingOwnership.headers.get('cache-control'), 'no-store');

  const unknownProtocol = await handleEvidenceManifestDetail(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence/manifests/${MANIFEST_ID}`),
    RUN_ID,
    MANIFEST_ID,
    createDependencies({
      repository: createRepository({
        getManifest: async () => { throw new EvidenceTypeError('EVIDENCE_RENDERED_PLAN_INVALID'); },
      }),
    }),
  );
  assert.equal(unknownProtocol.status, 422);
  assert.equal((await unknownProtocol.json()).message, 'INVALID_QUERY');

  const rawProviderError = 'Authorization: Bearer provider-secret raw-body';
  const unavailable = await handleEvidenceReportPost(
    reportRequest(manifest, 'evidence-report-status-raw-error'),
    RUN_ID,
    createDependencies({
      reportService: {
        async executeAttempt() { throw new Error(rawProviderError); },
      },
    }),
  );
  const unavailableBody = await unavailable.json();
  assert.equal(unavailable.status, 503);
  assert.equal(unavailableBody.message, 'EVIDENCE_SERVICE_UNAVAILABLE');
  assert.equal(JSON.stringify(unavailableBody).includes(rawProviderError), false);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
});

test('disabled feature, unbounded POST body and unapproved GET filters fail closed', async () => {
  const manifest = fixtureManifest();
  let serviceCalls = 0;
  const dependencies = createDependencies({
    reportService: {
      async executeAttempt() {
        serviceCalls += 1;
        return { attempt: fixtureAttempt(manifest), replayed: false, report: null };
      },
    },
  });

  const disabled = await handleEvidenceLatestManifest(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence`),
    RUN_ID,
    createDependencies({ queryEnabled: () => false }),
  );
  assert.equal(disabled.status, 404);
  assert.equal(disabled.headers.get('cache-control'), 'no-store');

  const filteredList = await handleEvidenceManifestList(
    getRequest(`/internal/fault-runs/${RUN_ID}/evidence/manifests?source=prometheus`),
    RUN_ID,
    dependencies,
  );
  assert.equal(filteredList.status, 400);

  const oversizedBody = new NextRequest(
    `http://localhost/internal/fault-runs/${RUN_ID}/evidence/reports`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-value',
        'X-Idempotency-Key': 'evidence-report-oversized-001',
      },
      body: JSON.stringify({
        manifestId: MANIFEST_ID,
        manifestHash: manifest.manifestHash,
        confirmed: true,
        padding: 'x'.repeat(5000),
      }),
    },
  );
  const oversizedResponse = await handleEvidenceReportPost(
    oversizedBody,
    RUN_ID,
    dependencies,
  );
  assert.equal(oversizedResponse.status, 400);
  assert.equal(serviceCalls, 0);
});

function createDependencies(
  overrides: Partial<EvidenceApiRouteDependencies> = {},
): EvidenceApiRouteDependencies {
  return {
    queryEnabled: () => true,
    repository: createRepository(),
    reportService: {
      async executeAttempt() {
        throw new Error('report service should not be called');
      },
    },
    csrfValid: () => true,
    operatorId: () => 7,
    correlationId: () => 'trace-route',
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<EvidenceApiRouteDependencies['repository']> = {},
): EvidenceApiRouteDependencies['repository'] {
  const manifest = fixtureManifest();
  return {
    async getLatestManifest() {
      return manifest;
    },
    async getOrCreateManifestForRun() {
      return { manifest, created: false };
    },
    async listManifests() {
      return [manifest];
    },
    async getManifest() {
      return manifest;
    },
    async listReportAttempts() {
      return [fixtureAttempt(manifest)];
    },
    async listReportAttemptItems() {
      return [fixtureItem()];
    },
    async listOperatorNotes() {
      return [fixtureNote(manifest)];
    },
    async createOperatorNote() {
      throw new Error('note repository should not be called');
    },
    ...overrides,
  };
}

function fixtureManifest(sourceRunRetained = true): EvidenceManifestRecord {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'BROWSE_REPORT_SQL')!;
  const contract = resolveScenarioContract(definition);
  const plan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const snapshot = parseEvidenceStoredContractSnapshot({
    ...createEvidenceCaptureSnapshot(getScenarioContractRevision(contract), contract.evidence, plan),
    snapshotId: '223e4567-e89b-12d3-a456-426614174001',
    sourceFaultRunId: RUN_ID,
    scenario: definition.scenario,
    contractSchemaVersion: 'evidence-contract.v1',
    rendererRevision: plan.rendererRevision,
    evaluationRevision: plan.evaluationRevision,
    createdAt: '2026-10-09T05:00:00.000Z',
  });
  const timeline = {
    createdAt: '2026-10-09T05:00:00.000Z',
    prepareStartedAt: '2026-10-09T05:01:00.000Z',
    activeAt: '2026-10-09T05:05:00.000Z',
    stopRequestedAt: '2026-10-09T05:10:00.000Z',
    recoveryStartedAt: '2026-10-09T05:11:00.000Z',
    recoveredAt: '2026-10-09T05:15:00.000Z',
    cleanupFinishedAt: null,
    terminalAt: '2026-10-09T05:16:00.000Z',
    terminalState: 'RECOVERED' as const,
  };
  const draft = createEvidenceManifestDraft(snapshot, timeline);
  return parseEvidenceManifest({
    ...draft,
    manifestId: MANIFEST_ID,
    manifestRevision: 1,
    manifestHash: getEvidenceManifestHash(draft),
    sourceRunRetained,
    materializedAt: NOW,
  });
}

function fixtureAttempt(manifest: EvidenceManifestRecord): EvidenceAttemptRecord {
  return {
    attemptId: ATTEMPT_ID,
    manifestId: manifest.manifestId,
    sourceFaultRunId: RUN_ID,
    requestHash: 'a'.repeat(64),
    state: 'COMPLETED',
    evidenceStatus: 'AVAILABLE',
    operatorAuditId: 7,
    requestedAt: NOW,
    deadlineAt: '2026-10-09T06:00:20.000Z',
    completedAt: NOW,
    totalDurationMs: 100,
    failureCode: null,
  };
}

function fixtureNote(manifest: EvidenceManifestRecord) {
  return {
    noteId: '623e4567-e89b-12d3-a456-426614174005',
    manifestId: manifest.manifestId,
    sourceFaultRunId: RUN_ID,
    requestHash: 'd'.repeat(64),
    operatorAuditId: 7,
    text: 'Recovery looked stable.',
    createdAt: NOW,
  };
}

function fixtureItem(): EvidenceAttemptItemRecord {
  return {
    recipeId: 'browse-report-sql.prometheus.catalog-report.active-report-p99',
    source: 'PROMETHEUS',
    window: 'active',
    availability: 'AVAILABLE',
    coverage: 'FULL',
    predicateOutcome: 'MET',
    reasonCode: null,
    durationMs: 10,
    queriedAt: NOW,
    executedStartAt: '2026-10-09T05:00:00.000Z',
    executedEndAt: NOW,
  };
}

function getRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`);
}

function reportRequest(
  manifest: EvidenceManifestRecord,
  idempotencyKey: string,
): NextRequest {
  return new NextRequest(`http://localhost/internal/fault-runs/${RUN_ID}/evidence/reports`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-value',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      manifestId: MANIFEST_ID,
      manifestHash: manifest.manifestHash,
      confirmed: true,
    }),
  });
}

function noteRequest(
  manifest: EvidenceManifestRecord,
  idempotencyKey: string,
  text: string,
): NextRequest {
  return new NextRequest(`http://localhost/internal/fault-runs/${RUN_ID}/evidence/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-value',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      manifestId: MANIFEST_ID,
      manifestHash: manifest.manifestHash,
      text,
    }),
  });
}
