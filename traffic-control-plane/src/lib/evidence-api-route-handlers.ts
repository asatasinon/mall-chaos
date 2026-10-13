import { NextRequest } from 'next/server';
import { BoundedJsonResponseError, readBoundedJsonResponse } from './bounded-json-response';
import { isCsrfRequest } from './csrf';
import {
  EvidenceRepositoryError,
  SqlEvidenceRepository,
  type CreateEvidenceNoteInput,
  type EvidenceHistoryListOptions,
} from './evidence-repository';
import { EvidenceReportServiceError, getEvidenceReportService } from './evidence-report-service';
import type { EvidenceReportService } from './evidence-report-service';
import { readEvidenceQueryEnabled } from './evidence-web-config';
import { EvidenceTypeError, type EvidenceManifestRecord } from './evidence-types';
import { validateEvidenceNoteText } from './evidence-note-policy';
import { getOperatorAuditOperatorId } from './operator-audit';
import { getOrCreateTraceId } from './trace';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_REPORT_REQUEST_BYTES = 4096;
const MAX_NOTE_REQUEST_BYTES = 4096;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

type EvidenceApiRepository = Pick<
  SqlEvidenceRepository,
  | 'getLatestManifest'
  | 'getOrCreateManifestForRun'
  | 'listManifests'
  | 'getManifest'
  | 'listReportAttempts'
  | 'listReportAttemptItems'
  | 'listOperatorNotes'
  | 'createOperatorNote'
>;

export interface EvidenceApiRouteDependencies {
  readonly queryEnabled: () => boolean;
  readonly repository: EvidenceApiRepository;
  readonly reportService: Pick<EvidenceReportService, 'executeAttempt'>;
  readonly csrfValid: (request: NextRequest) => boolean;
  readonly operatorId: (request: Request) => number | null;
  readonly correlationId: (headers: Headers) => string;
}

const defaultDependencies: EvidenceApiRouteDependencies = {
  queryEnabled: readEvidenceQueryEnabled,
  repository: new SqlEvidenceRepository(),
  reportService: getEvidenceReportService(),
  csrfValid: isCsrfRequest,
  operatorId: getOperatorAuditOperatorId,
  correlationId: getOrCreateTraceId,
};

export async function handleEvidenceLatestManifest(
  request: NextRequest,
  faultRunId: string,
  dependencies: EvidenceApiRouteDependencies = defaultDependencies,
): Promise<Response> {
  if (!isUuid(faultRunId)) return evidenceError(400, 'INVALID_FAULT_RUN_ID');
  const disabled = checkQueryEnabled(dependencies);
  if (disabled) return disabled;
  if (new URL(request.url).search) return evidenceError(400, 'UNEXPECTED_QUERY_PARAMETER');

  try {
    const current = await getCurrentManifest(dependencies.repository, faultRunId);
    if (current.legacy) {
      return evidenceOk({
        status: 'EVIDENCE_UNAVAILABLE',
        reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE',
        manifest: null,
      });
    }
    return evidenceOk(current.manifest);
  } catch (error) {
    return mapEvidenceApiError(error);
  }
}

export async function handleEvidenceManifestList(
  request: NextRequest,
  faultRunId: string,
  dependencies: EvidenceApiRouteDependencies = defaultDependencies,
): Promise<Response> {
  if (!isUuid(faultRunId)) return evidenceError(400, 'INVALID_FAULT_RUN_ID');
  const disabled = checkQueryEnabled(dependencies);
  if (disabled) return disabled;

  const url = new URL(request.url);
  const params = parseQueryParams(url.searchParams, ['limit', 'beforeRevision']);
  if (!params) return evidenceError(400, 'INVALID_EVIDENCE_PAGINATION');
  const limit = parseBoundedPositiveInteger(params.get('limit'), DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
  const beforeRevision = params.has('beforeRevision')
    ? parseBoundedPositiveInteger(params.get('beforeRevision'), null, 0xffff_ffff)
    : undefined;
  if (limit === null || beforeRevision === null) {
    return evidenceError(400, 'INVALID_EVIDENCE_PAGINATION');
  }

  try {
    const current = await getCurrentManifest(dependencies.repository, faultRunId);
    if (current.legacy) {
      return evidenceOk({
        status: 'EVIDENCE_UNAVAILABLE',
        reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE',
        manifests: [],
      });
    }
    const manifests = await dependencies.repository.listManifests(faultRunId, {
      limit,
      ...(beforeRevision === undefined ? {} : { beforeRevision }),
    });
    return evidenceOk({ manifests });
  } catch (error) {
    return mapEvidenceApiError(error);
  }
}

export async function handleEvidenceManifestDetail(
  request: NextRequest,
  faultRunId: string,
  manifestId: string,
  dependencies: EvidenceApiRouteDependencies = defaultDependencies,
): Promise<Response> {
  if (!isUuid(faultRunId)) return evidenceError(400, 'INVALID_FAULT_RUN_ID');
  if (!isUuid(manifestId)) return evidenceError(400, 'INVALID_MANIFEST_ID');
  const disabled = checkQueryEnabled(dependencies);
  if (disabled) return disabled;
  if (new URL(request.url).search) return evidenceError(400, 'UNEXPECTED_QUERY_PARAMETER');

  try {
    const manifest = await dependencies.repository.getManifest(faultRunId, manifestId);
    if (!manifest) return evidenceError(404, 'MANIFEST_NOT_FOUND');
    return evidenceOk(manifest);
  } catch (error) {
    return mapEvidenceApiError(error);
  }
}

export async function handleEvidenceReportHistory(
  request: NextRequest,
  faultRunId: string,
  dependencies: EvidenceApiRouteDependencies = defaultDependencies,
): Promise<Response> {
  if (!isUuid(faultRunId)) return evidenceError(400, 'INVALID_FAULT_RUN_ID');
  const disabled = checkQueryEnabled(dependencies);
  if (disabled) return disabled;

  const historyOptions = parseHistoryOptions(new URL(request.url).searchParams);
  if (!historyOptions) return evidenceError(400, 'INVALID_EVIDENCE_PAGINATION');

  try {
    const current = await getCurrentManifest(dependencies.repository, faultRunId);
    if (current.legacy) {
      return evidenceOk({
        status: 'EVIDENCE_UNAVAILABLE',
        reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE',
        reports: [],
      });
    }
    const attempts = await dependencies.repository.listReportAttempts(faultRunId, historyOptions);
    const reports: EvidenceReportHistoryItem[] = [];
    for (const attempt of attempts) {
      const manifest = await dependencies.repository.getManifest(faultRunId, attempt.manifestId);
      if (!manifest) return evidenceError(503, 'EVIDENCE_HISTORY_INCONSISTENT');
      const items = await dependencies.repository.listReportAttemptItems(faultRunId, attempt.attemptId);
      reports.push({
        attemptId: attempt.attemptId,
        manifestId: attempt.manifestId,
        manifestRevision: manifest.manifestRevision,
        manifestHash: manifest.manifestHash,
        state: attempt.state,
        evidenceStatus: attempt.evidenceStatus,
        requestedAt: attempt.requestedAt,
        completedAt: attempt.completedAt,
        totalDurationMs: attempt.totalDurationMs,
        failureCode: attempt.failureCode,
        operatorAuditId: attempt.operatorAuditId,
        items,
      });
    }
    return evidenceOk({ reports });
  } catch (error) {
    return mapEvidenceApiError(error);
  }
}

export async function handleEvidenceReportPost(
  request: NextRequest,
  faultRunId: string,
  dependencies: EvidenceApiRouteDependencies = defaultDependencies,
): Promise<Response> {
  if (!isUuid(faultRunId)) return evidenceError(400, 'INVALID_FAULT_RUN_ID');
  const disabled = checkQueryEnabled(dependencies);
  if (disabled) return disabled;
  if (!dependencies.csrfValid(request)) return evidenceError(403, 'CSRF_VALIDATION_FAILED');
  if (new URL(request.url).search) return evidenceError(400, 'UNEXPECTED_QUERY_PARAMETER');

  const idempotencyKey = request.headers.get('x-idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return evidenceError(400, 'INVALID_IDEMPOTENCY_KEY');
  }
  const body = await readRequestObject(request, MAX_REPORT_REQUEST_BYTES);
  if (!body || !hasExactKeys(body, ['manifestId', 'manifestHash', 'confirmed'])
    || typeof body.manifestId !== 'string' || !isUuid(body.manifestId)
    || typeof body.manifestHash !== 'string' || !SHA256_PATTERN.test(body.manifestHash)
    || body.confirmed !== true) {
    return evidenceError(400, 'INVALID_EVIDENCE_REPORT_REQUEST');
  }

  try {
    const result = await dependencies.reportService.executeAttempt({
      sourceFaultRunId: faultRunId,
      manifestId: body.manifestId,
      manifestHash: body.manifestHash,
      idempotencyKey,
      operatorId: dependencies.operatorId(request),
      correlationId: dependencies.correlationId(request.headers),
    }, request.signal);
    return evidenceOk(result);
  } catch (error) {
    return mapEvidenceApiError(error);
  }
}

export async function handleEvidenceNoteHistory(
  request: NextRequest,
  faultRunId: string,
  dependencies: EvidenceApiRouteDependencies = defaultDependencies,
): Promise<Response> {
  if (!isUuid(faultRunId)) return evidenceError(400, 'INVALID_FAULT_RUN_ID');
  const disabled = checkQueryEnabled(dependencies);
  if (disabled) return disabled;
  const historyOptions = parseHistoryOptions(new URL(request.url).searchParams);
  if (!historyOptions) return evidenceError(400, 'INVALID_EVIDENCE_PAGINATION');

  try {
    const current = await getCurrentManifest(dependencies.repository, faultRunId);
    if (current.legacy) {
      return evidenceOk({
        status: 'EVIDENCE_UNAVAILABLE',
        reasonCode: 'CONTRACT_SNAPSHOT_UNAVAILABLE',
        notes: [],
      });
    }
    const notes = await dependencies.repository.listOperatorNotes(faultRunId, historyOptions);
    return evidenceOk({ notes });
  } catch (error) {
    return mapEvidenceApiError(error);
  }
}

export async function handleEvidenceNotePost(
  request: NextRequest,
  faultRunId: string,
  dependencies: EvidenceApiRouteDependencies = defaultDependencies,
): Promise<Response> {
  if (!isUuid(faultRunId)) return evidenceError(400, 'INVALID_FAULT_RUN_ID');
  const disabled = checkQueryEnabled(dependencies);
  if (disabled) return disabled;
  if (!dependencies.csrfValid(request)) return evidenceError(403, 'CSRF_VALIDATION_FAILED');
  if (new URL(request.url).search) return evidenceError(400, 'UNEXPECTED_QUERY_PARAMETER');

  const idempotencyKey = request.headers.get('x-idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return evidenceError(400, 'INVALID_IDEMPOTENCY_KEY');
  }
  const body = await readRequestObject(request, MAX_NOTE_REQUEST_BYTES);
  if (!body || !hasExactKeys(body, ['manifestId', 'manifestHash', 'text'])
    || typeof body.manifestId !== 'string' || !isUuid(body.manifestId)
    || typeof body.manifestHash !== 'string' || !SHA256_PATTERN.test(body.manifestHash)
    || typeof body.text !== 'string') {
    return evidenceError(400, 'INVALID_EVIDENCE_NOTE');
  }
  const validation = validateEvidenceNoteText(body.text);
  if (!validation.valid) return evidenceError(400, validation.reasonCode);

  const input: CreateEvidenceNoteInput = {
    sourceFaultRunId: faultRunId,
    manifestId: body.manifestId,
    manifestHash: body.manifestHash,
    idempotencyKey,
    text: validation.text,
    operatorId: dependencies.operatorId(request),
    correlationId: dependencies.correlationId(request.headers),
  };
  try {
    const result = await dependencies.repository.createOperatorNote(input);
    return evidenceOk(result);
  } catch (error) {
    return mapEvidenceApiError(error);
  }
}

interface EvidenceReportHistoryItem {
  readonly attemptId: string;
  readonly manifestId: string;
  readonly manifestRevision: number;
  readonly manifestHash: string;
  readonly state: string;
  readonly evidenceStatus: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly totalDurationMs: number | null;
  readonly failureCode: string | null;
  readonly operatorAuditId: number | null;
  readonly items: Awaited<ReturnType<EvidenceApiRepository['listReportAttemptItems']>>;
}

function parseHistoryOptions(params: URLSearchParams): EvidenceHistoryListOptions | null {
  const parsed = parseQueryParams(params, ['limit', 'beforeAt', 'beforeId']);
  if (!parsed) return null;
  const limit = parseBoundedPositiveInteger(parsed.get('limit'), DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
  const beforeAt = parsed.has('beforeAt') ? parsed.get('beforeAt') : undefined;
  const beforeId = parsed.has('beforeId') ? parsed.get('beforeId') : undefined;
  if (limit === null || (beforeAt === undefined) !== (beforeId === undefined)
    || beforeAt !== undefined && (beforeAt.length > 32 || !isUuid(beforeId ?? ''))) {
    return null;
  }
  return {
    limit,
    ...(beforeAt === undefined ? {} : { beforeAt, beforeId }),
  };
}

async function getCurrentManifest(
  repository: EvidenceApiRepository,
  faultRunId: string,
): Promise<{ readonly manifest: EvidenceManifestRecord | null; readonly legacy: boolean }> {
  const latest = await repository.getLatestManifest(faultRunId);
  if (latest) return { manifest: latest, legacy: false };
  try {
    const materialized = await repository.getOrCreateManifestForRun(faultRunId);
    return { manifest: materialized.manifest, legacy: false };
  } catch (error) {
    if (error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_NOT_FOUND') {
      return { manifest: null, legacy: true };
    }
    if (error instanceof EvidenceRepositoryError
      && error.code === 'EVIDENCE_SOURCE_RUN_NOT_RETAINED') {
      const retainedManifest = await repository.getLatestManifest(faultRunId);
      if (retainedManifest) return { manifest: retainedManifest, legacy: false };
    }
    throw error;
  }
}

function checkQueryEnabled(dependencies: EvidenceApiRouteDependencies): Response | null {
  try {
    if (!dependencies.queryEnabled()) return evidenceError(404, 'EVIDENCE_QUERY_DISABLED');
    return null;
  } catch {
    return evidenceError(503, 'EVIDENCE_QUERY_CONFIGURATION_UNAVAILABLE');
  }
}

function mapEvidenceApiError(error: unknown): Response {
  if (error instanceof EvidenceTypeError) {
    return evidenceError(422, 'INVALID_QUERY');
  }
  if (error instanceof EvidenceRepositoryError) {
    switch (error.code) {
      case 'EVIDENCE_SOURCE_RUN_NOT_TERMINAL':
        return evidenceError(409, 'RUN_NOT_TERMINAL');
      case 'EVIDENCE_SOURCE_RUN_NOT_RETAINED':
        return evidenceError(404, 'FAULT_RUN_NOT_FOUND');
      case 'EVIDENCE_MANIFEST_NOT_FOUND':
      case 'EVIDENCE_CONTRACT_SNAPSHOT_NOT_FOUND':
        return evidenceError(404, 'MANIFEST_NOT_FOUND');
      case 'EVIDENCE_MANIFEST_SOURCE_RUN_MISMATCH':
      case 'EVIDENCE_MANIFEST_HASH_CONFLICT':
        return evidenceError(409, 'MANIFEST_REVISION_MISMATCH');
      case 'EVIDENCE_IDEMPOTENCY_KEY_REUSED':
        return evidenceError(409, 'IDEMPOTENCY_KEY_REUSED');
      case 'EVIDENCE_ATTEMPT_NOT_FOUND':
        return evidenceError(404, 'REPORT_ATTEMPT_NOT_FOUND');
      case 'EVIDENCE_ATTEMPT_NOT_RUNNING':
        return evidenceError(409, 'REPORT_ATTEMPT_NOT_RUNNING');
      case 'EVIDENCE_ATTEMPT_DEADLINE_EXCEEDED':
        return evidenceError(409, 'REPORT_ATTEMPT_EXPIRED');
      case 'EVIDENCE_REPOSITORY_INVALID_INPUT':
        return evidenceError(400, 'INVALID_EVIDENCE_REQUEST');
      default:
        return evidenceError(503, 'EVIDENCE_STORE_UNAVAILABLE');
    }
  }
  if (error instanceof EvidenceReportServiceError) {
    switch (error.code) {
      case 'EVIDENCE_REPORT_BUSY':
        return evidenceError(429, 'EVIDENCE_QUERY_BUSY');
      case 'EVIDENCE_REPORT_MANIFEST_INVALID':
        return evidenceError(422, 'INVALID_QUERY');
      case 'EVIDENCE_REPORT_EXECUTION_DISABLED':
        return evidenceError(503, 'EVIDENCE_QUERY_EXECUTION_DISABLED');
      case 'EVIDENCE_REPORT_DATABASE_TIME_UNAVAILABLE':
        return evidenceError(503, 'EVIDENCE_DATABASE_TIME_UNAVAILABLE');
      case 'EVIDENCE_REPORT_CANCELLED':
        return evidenceError(408, 'EVIDENCE_REPORT_CANCELLED');
    }
  }
  return evidenceError(503, 'EVIDENCE_SERVICE_UNAVAILABLE');
}

function parseQueryParams(
  params: URLSearchParams,
  allowed: readonly string[],
): Map<string, string> | null {
  const allowedSet = new Set(allowed);
  const result = new Map<string, string>();
  for (const key of params.keys()) {
    if (!allowedSet.has(key) || result.has(key)) return null;
    const values = params.getAll(key);
    if (values.length !== 1) return null;
    result.set(key, values[0]!);
  }
  return result;
}

function parseBoundedPositiveInteger(
  value: string | null | undefined,
  defaultValue: number | null,
  maximum: number,
): number | null {
  if (value === null || value === undefined) return defaultValue;
  if (!/^[1-9]\d{0,9}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

async function readRequestObject(
  request: NextRequest,
  maximumBytes: number,
): Promise<Record<string, unknown> | null> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return null;
  }
  try {
    const body = await readBoundedJsonResponse(
      new Response(request.body, { headers: request.headers }),
      maximumBytes,
    );
    return isPlainRecord(body) ? body : null;
  } catch (error) {
    if (error instanceof BoundedJsonResponseError) return null;
    throw error;
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function evidenceOk(data: unknown, status = 200): Response {
  return Response.json({ code: 0, message: 'ok', data }, {
    status,
    headers: evidenceHeaders(),
  });
}

function evidenceError(status: number, message: string): Response {
  return Response.json({ code: status, message, data: null }, {
    status,
    headers: evidenceHeaders(),
  });
}

function evidenceHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
  });
}
