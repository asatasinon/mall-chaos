import { fetchWithAuth } from '@/lib/auth-fetch';
import { BoundedJsonResponseError, readBoundedJsonResponse } from '@/lib/bounded-json-response';
import {
  bindEvidenceHistoryToManifests,
  parseEvidenceManifestList,
  parseEvidenceManifestView,
  parseEvidenceNoteHistory,
  parseEvidenceReportHistory,
  type EvidenceManifestView,
  type EvidencePanelMetadata,
} from './evidence-view';

type EvidenceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const MAX_EVIDENCE_METADATA_RESPONSE_BYTES = 1024 * 1024;

export class EvidencePanelRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'EvidencePanelRequestError';
  }
}

export type EvidencePanelLoadFailure =
  | { readonly kind: 'not-terminal' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'error'; readonly code: string };

export function classifyEvidencePanelLoadFailure(error: unknown): EvidencePanelLoadFailure {
  const code = getEvidencePanelErrorCode(error);
  if (code === 'RUN_NOT_TERMINAL') return { kind: 'not-terminal' };
  if (code === 'EVIDENCE_QUERY_DISABLED') return { kind: 'disabled' };
  return { kind: 'error', code };
}

export function getEvidencePanelErrorCode(error: unknown): string {
  return error instanceof EvidencePanelRequestError
    ? error.code
    : 'EVIDENCE_SERVICE_UNAVAILABLE';
}

export type EvidencePanelLoadResult =
  | { readonly state: 'ready'; readonly metadata: EvidencePanelMetadata }
  | { readonly state: 'unavailable'; readonly reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE' };

export async function loadEvidencePanelMetadata(
  sourceRunId: string,
  signal?: AbortSignal,
  fetcher: EvidenceFetch = fetchWithAuth,
): Promise<EvidencePanelLoadResult> {
  const base = `/internal/fault-runs/${encodeURIComponent(sourceRunId)}/evidence`;
  const latestData = await getJson(`${base}`, signal, fetcher);
  if (isLegacyUnavailable(latestData)) {
    return { state: 'unavailable', reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE' };
  }
  const latestManifest = parseEvidenceManifestView(latestData, sourceRunId);
  if (!latestManifest) throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');

  const [manifestData, reportData, noteData] = await Promise.all([
    getJson(`${base}/manifests?limit=50`, signal, fetcher),
    getJson(`${base}/reports?limit=50`, signal, fetcher),
    getJson(`${base}/notes?limit=50`, signal, fetcher),
  ]);
  const manifests = parseEvidenceManifestList(manifestData, sourceRunId);
  const reports = parseEvidenceReportHistory(reportData);
  const notes = parseEvidenceNoteHistory(noteData, sourceRunId);
  if (!manifests || !reports || !notes) {
    throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
  }
  const latestListEntry = manifests.find((manifest) => manifest.manifestId === latestManifest.manifestId);
  if (latestListEntry
    && (latestListEntry.manifestHash !== latestManifest.manifestHash
      || latestListEntry.manifestRevision !== latestManifest.manifestRevision)) {
    throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
  }
  const allManifests = latestListEntry ? manifests : [latestManifest, ...manifests].slice(0, 100);
  const history = bindEvidenceHistoryToManifests(allManifests, reports, notes);
  if (!history) throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
  return {
    state: 'ready',
    metadata: {
      latestManifest,
      manifests: allManifests,
      reports: history.reports,
      notes: history.notes,
      omittedReportCount: history.omittedReportCount,
      omittedNoteCount: history.omittedNoteCount,
    },
  };
}

export async function loadSelectedEvidenceManifest(
  sourceRunId: string,
  manifestId: string,
  signal?: AbortSignal,
  fetcher: EvidenceFetch = fetchWithAuth,
): Promise<EvidenceManifestView> {
  const url = `/internal/fault-runs/${encodeURIComponent(sourceRunId)}`
    + `/evidence/manifests/${encodeURIComponent(manifestId)}`;
  const value = await getJson(url, signal, fetcher);
  const manifest = parseEvidenceManifestView(value, sourceRunId);
  if (!manifest || manifest.manifestId !== manifestId) {
    throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
  }
  return manifest;
}

export function submitEvidenceReport(
  sourceRunId: string,
  manifestId: string,
  manifestHash: string,
  idempotencyKey: string,
  signal?: AbortSignal,
  fetcher: EvidenceFetch = fetchWithAuth,
): Promise<unknown> {
  return postJson(
    `/internal/fault-runs/${encodeURIComponent(sourceRunId)}/evidence/reports`,
    idempotencyKey,
    { manifestId, manifestHash, confirmed: true },
    signal,
    fetcher,
  );
}

export function submitEvidenceNote(
  sourceRunId: string,
  manifestId: string,
  manifestHash: string,
  idempotencyKey: string,
  text: string,
  signal?: AbortSignal,
  fetcher: EvidenceFetch = fetchWithAuth,
): Promise<unknown> {
  return postJson(
    `/internal/fault-runs/${encodeURIComponent(sourceRunId)}/evidence/notes`,
    idempotencyKey,
    { manifestId, manifestHash, text },
    signal,
    fetcher,
  );
}

async function getJson(
  url: string,
  signal: AbortSignal | undefined,
  fetcher: EvidenceFetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: 'GET',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  let payload: unknown;
  try {
    payload = await readBoundedJsonResponse(response, MAX_EVIDENCE_METADATA_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedJsonResponseError) {
      throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
    }
    throw error;
  }
  return unwrapApiEnvelope(response, payload);
}

async function postJson(
  url: string,
  idempotencyKey: string,
  body: Record<string, string | boolean>,
  signal: AbortSignal | undefined,
  fetcher: EvidenceFetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    ...(signal ? { signal } : {}),
    body: JSON.stringify(body),
  });
  let payload: unknown;
  try {
    payload = await readBoundedJsonResponse(response, MAX_EVIDENCE_METADATA_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedJsonResponseError) {
      throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
    }
    throw error;
  }
  return unwrapApiEnvelope(response, payload);
}

function unwrapApiEnvelope(response: Response, payload: unknown): unknown {
  if (!isRecord(payload) || typeof payload.code !== 'number' || typeof payload.message !== 'string') {
    throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
  }
  if (!response.ok || payload.code !== 0) {
    const code = /^[A-Z][A-Z0-9_]{0,63}$/u.test(payload.message)
      ? payload.message
      : 'EVIDENCE_SERVICE_UNAVAILABLE';
    throw new EvidencePanelRequestError(response.status, code);
  }
  return payload.data;
}

function isLegacyUnavailable(
  value: unknown,
): value is { readonly status: 'EVIDENCE_UNAVAILABLE'; readonly reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE' } {
  return isRecord(value)
    && value.status === 'EVIDENCE_UNAVAILABLE'
    && value.reasonCode === 'CONTRACT_SNAPSHOT_UNAVAILABLE'
    && value.manifest === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
