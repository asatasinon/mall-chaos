import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyEvidencePanelLoadFailure,
  EvidencePanelRequestError,
  loadEvidencePanelMetadata,
  loadSelectedEvidenceManifest,
  submitEvidenceNote,
  submitEvidenceReport,
} from './evidence-panel-client';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const MANIFEST_ID = '323e4567-e89b-12d3-a456-426614174002';

test('opening the Evidence panel uses bounded metadata GETs only', async () => {
  const requests: { readonly url: string; readonly method: string; readonly cache: RequestCache | undefined }[] = [];
  const manifest = manifestFixture();
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method, cache: init?.cache });
    const data = url.endsWith('/manifests?limit=50')
      ? { manifests: [manifest] }
      : url.endsWith('/reports?limit=50')
        ? { reports: [] }
        : url.endsWith('/notes?limit=50')
          ? { notes: [] }
          : manifest;
    return jsonResponse(data);
  };

  const result = await loadEvidencePanelMetadata(RUN_ID, undefined, fetcher);

  assert.equal(result.state, 'ready');
  assert.deepEqual(requests.map(({ method }) => method), ['GET', 'GET', 'GET', 'GET']);
  assert.deepEqual(requests.map(({ cache }) => cache), ['no-store', 'no-store', 'no-store', 'no-store']);
  assert.deepEqual(requests.map(({ url }) => url), [
    `/internal/fault-runs/${RUN_ID}/evidence`,
    `/internal/fault-runs/${RUN_ID}/evidence/manifests?limit=50`,
    `/internal/fault-runs/${RUN_ID}/evidence/reports?limit=50`,
    `/internal/fault-runs/${RUN_ID}/evidence/notes?limit=50`,
  ]);
});

test('selecting an older Manifest fetches only its source-run-bound detail', async () => {
  const requests: { readonly url: string; readonly method: string }[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), method: init?.method ?? 'GET' });
    return jsonResponse(manifestFixture());
  };

  const manifest = await loadSelectedEvidenceManifest(RUN_ID, MANIFEST_ID, undefined, fetcher);

  assert.equal(manifest.manifestId, MANIFEST_ID);
  assert.deepEqual(requests, [{
    url: `/internal/fault-runs/${RUN_ID}/evidence/manifests/${MANIFEST_ID}`,
    method: 'GET',
  }]);
});

test('legacy Evidence response is represented without issuing follow-up reads', async () => {
  const requests: string[] = [];
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    requests.push(String(input));
    return jsonResponse({
      status: 'EVIDENCE_UNAVAILABLE',
      reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE',
      manifest: null,
    });
  };

  const result = await loadEvidencePanelMetadata(RUN_ID, undefined, fetcher);

  assert.deepEqual(result, {
    state: 'unavailable',
    reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE',
  });
  assert.equal(requests.length, 1);
});

test('oversized metadata response is rejected before JSON parsing', async () => {
  const fetcher = async (): Promise<Response> => new Response('{"data":"too large"}', {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(1024 * 1024 + 1),
    },
  });

  test('Evidence load errors use fixed UI states and never expose raw exception text', () => {
    assert.deepEqual(
      classifyEvidencePanelLoadFailure(new EvidencePanelRequestError(409, 'RUN_NOT_TERMINAL')),
      { kind: 'not-terminal' },
    );
    assert.deepEqual(
      classifyEvidencePanelLoadFailure(new EvidencePanelRequestError(404, 'EVIDENCE_QUERY_DISABLED')),
      { kind: 'disabled' },
    );
    assert.deepEqual(
      classifyEvidencePanelLoadFailure(new Error('Authorization: Bearer private-token')),
      { kind: 'error', code: 'EVIDENCE_SERVICE_UNAVAILABLE' },
    );
  });

  await assert.rejects(
    loadEvidencePanelMetadata(RUN_ID, undefined, fetcher),
    (error: unknown) => error instanceof Error
      && error.name === 'EvidencePanelRequestError'
      && error.message === 'EVIDENCE_RESPONSE_INVALID',
  );
});

test('explicit report and note submissions preserve their manifest identity and idempotency key', async () => {
  const requests: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), init });
    return jsonResponse({ accepted: true });
  };
  const idempotencyKey = 'evidence-report-client-key-001';

  await submitEvidenceReport(RUN_ID, MANIFEST_ID, 'a'.repeat(64), idempotencyKey, undefined, fetcher);
  await submitEvidenceReport(RUN_ID, MANIFEST_ID, 'a'.repeat(64), idempotencyKey, undefined, fetcher);
  await submitEvidenceNote(
    RUN_ID,
    MANIFEST_ID,
    'a'.repeat(64),
    'evidence-note-client-key-001',
    'An operator note.',
    undefined,
    fetcher,
  );
  await submitEvidenceNote(
    RUN_ID,
    MANIFEST_ID,
    'a'.repeat(64),
    'evidence-note-client-key-001',
    'An operator note.',
    undefined,
    fetcher,
  );

  assert.equal(requests[0]?.init?.method, 'POST');
  assert.equal(requests[0]?.init?.cache, 'no-store');
  assert.equal(new Headers(requests[0]?.init?.headers).get('x-idempotency-key'), idempotencyKey);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    manifestId: MANIFEST_ID,
    manifestHash: 'a'.repeat(64),
    confirmed: true,
  });
  assert.equal(new Headers(requests[1]?.init?.headers).get('x-idempotency-key'), idempotencyKey);
  assert.equal(requests[1]?.init?.body, requests[0]?.init?.body);
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
    manifestId: MANIFEST_ID,
    manifestHash: 'a'.repeat(64),
    text: 'An operator note.',
  });
  assert.equal(new Headers(requests[3]?.init?.headers).get('x-idempotency-key'), 'evidence-note-client-key-001');
  assert.equal(requests[3]?.init?.body, requests[2]?.init?.body);
});

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function manifestFixture() {
  return {
    manifestId: MANIFEST_ID,
    sourceFaultRunId: RUN_ID,
    manifestRevision: 1,
    manifestHash: 'a'.repeat(64),
    sourceRunRetained: true,
    materializedAt: '2026-10-11T06:00:00.000Z',
    windows: [{
      name: 'active',
      state: 'READY',
      canonicalStartAt: '2026-10-11T05:00:00.000Z',
      canonicalEndAt: '2026-10-11T05:10:00.000Z',
      reasonCode: null,
    }],
    recipes: [{
      recipeId: 'catalog-report.p99',
      source: 'PROMETHEUS',
      window: 'active',
      observationMode: 'WINDOWED',
      required: true,
      valueUnit: 'seconds',
      lookbackSec: 300,
      baselineForRecipeId: null,
      businessCheckId: null,
      renderedQuery: 'sum(rate(catalog_requests_total[5m]))',
    }],
    limitations: [],
  };
}
