const MAX_PAYLOAD_BYTES = 8 * 1024;
const FAILURE_CODES = new Set([
  'TARGET_EFFECT_REJECTED',
  'TARGET_EFFECT_UNOBSERVED',
  'CONTROL_PLANE_VALIDATION_FAILED',
  'CONTROL_PLANE_STORAGE_FAILED',
  'WORKER_SETUP_FAILED',
  'WORKER_REQUEST_FAILED',
  'WORKER_SUMMARY_MISSING',
  'WORKER_DRAIN_INCOMPLETE',
  'RECOVERY_RELEASE_FAILED',
  'RECOVERY_COMPENSATION_FAILED',
  'BUSINESS_RECOVERY_UNCONFIRMED',
  'CLEANUP_REQUIRED',
  'CLEANUP_FAILED',
  'CLEANUP_UNVERIFIED',
  'RUN_NOT_TERMINAL',
  'SOURCE_RUN_NOT_FOUND',
  'CATALOG_REVISION_FAILED',
  'BASELINE_CAPTURE_DISABLED',
]);

const SUMMARY_EVENT_META: Record<string, {
  source: 'report-worker' | 'scenario-worker' | 'runner';
  phase: 'effect' | 'worker' | 'recovery';
  status: 'STARTED' | 'COMPLETED' | 'FAILED' | 'DRAINED';
}> = {
  REPORT_WORKER_STARTED: { source: 'report-worker', phase: 'worker', status: 'STARTED' },
  REPORT_WORKER_STOPPED: { source: 'report-worker', phase: 'worker', status: 'COMPLETED' },
  SCENARIO_WORKER_STARTED: { source: 'scenario-worker', phase: 'worker', status: 'STARTED' },
  SCENARIO_WORKER_STOPPED: { source: 'scenario-worker', phase: 'worker', status: 'COMPLETED' },
  SCENARIO_WORKER_DRAINED: { source: 'scenario-worker', phase: 'recovery', status: 'DRAINED' },
  RUNNER_LIFECYCLE_SUMMARY: { source: 'runner', phase: 'effect', status: 'COMPLETED' },
  SCENARIO_WORKER_SETUP_FAILED: { source: 'scenario-worker', phase: 'worker', status: 'FAILED' },
  REPORT_WORKER_SETUP_FAILED: { source: 'report-worker', phase: 'worker', status: 'FAILED' },
  SCENARIO_REQUEST_FAILED: { source: 'scenario-worker', phase: 'effect', status: 'FAILED' },
};

const CAPTURE_EVENT_META: Record<string, {
  phase: 'control' | 'effect' | 'recovery';
  status: 'STARTED' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
}> = {
  BASELINE_CAPTURE_REQUESTED: { phase: 'control', status: 'STARTED' },
  BASELINE_RUNTIME_SUMMARY_RECORDED: { phase: 'effect', status: 'COMPLETED' },
  BASELINE_OBSERVATION_CHECK_RECORDED: { phase: 'effect', status: 'UNKNOWN' },
  BASELINE_CAPTURE_COMPLETED: { phase: 'control', status: 'COMPLETED' },
  BASELINE_CAPTURE_INCOMPLETE: { phase: 'control', status: 'UNKNOWN' },
  BASELINE_CAPTURE_FAILED: { phase: 'control', status: 'FAILED' },
};

export class FaultRunEventContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultRunEventContractError';
  }
}

export function normalizeFaultRunSummaryEventPayload(
  eventType: string,
  value: unknown,
): Record<string, unknown> {
  const metadata = SUMMARY_EVENT_META[eventType];
  if (!metadata) throw new FaultRunEventContractError(`UNSUPPORTED_SUMMARY_EVENT:${eventType}`);
  const source = asRecord(value);
  const normalized: Record<string, unknown> = {
    schemaVersion: 1,
    source: metadata.source,
    phase: metadata.phase,
    status: metadata.status,
  };

  if (eventType === 'REPORT_WORKER_STARTED') {
    copyCounter(source, normalized, 'requestIntervalMs');
  } else if (eventType === 'REPORT_WORKER_STOPPED') {
    copyCounter(source, normalized, 'requests');
    copyCounter(source, normalized, 'successes');
    copyCounter(source, normalized, 'failures');
    copyLatency(source, normalized, 'averageLatencyMs');
    copyStableText(source, normalized, 'reason', 'EXPIRED_OR_STOPPED');
  } else if (eventType === 'SCENARIO_WORKER_STARTED') {
    copyCounter(source, normalized, 'concurrency');
    copyCounter(source, normalized, 'requestIntervalMs');
  } else if (eventType === 'SCENARIO_WORKER_STOPPED' || eventType === 'SCENARIO_WORKER_DRAINED') {
    copyCounter(source, normalized, 'requests');
    copyCounter(source, normalized, 'successes');
    copyCounter(source, normalized, 'failures');
    copyCounter(source, normalized, 'timeouts');
    copyCounter(source, normalized, 'inFlight');
    copyLatency(source, normalized, 'averageLatencyMs');
    copyLatency(source, normalized, 'p50LatencyMs');
    copyLatency(source, normalized, 'p95LatencyMs');
    copyLatency(source, normalized, 'p99LatencyMs');
    copyStableText(source, normalized, 'stopReason', 'UNKNOWN');
    const cacheResults = normalizeCacheResults(source.cacheResults);
    if (cacheResults) normalized.cacheResults = cacheResults;
  } else if (eventType === 'SCENARIO_REQUEST_FAILED') {
    const failureCode = normalizeFailureCode(source.failureCode ?? source.errorCode);
    normalized.failureCode = failureCode ?? 'WORKER_REQUEST_FAILED';
    if (typeof source.timeout === 'boolean') normalized.timeout = source.timeout;
    const cacheResult = normalizeCacheResult(source.cacheResult);
    if (cacheResult) normalized.cacheResult = cacheResult;
  } else if (eventType === 'RUNNER_LIFECYCLE_SUMMARY') {
    const resultStatus = normalizeResultStatus(source.resultStatus ?? source.status);
    normalized.resultStatus = resultStatus;
    if (typeof source.success === 'boolean') normalized.success = source.success;
    copyLatency(source, normalized, 'latencyMs');
    const failureCode = normalizeFailureCode(source.failureCode ?? source.errorCode);
    if (failureCode) normalized.failureCode = failureCode;
  } else {
    normalized.failureCode = normalizeFailureCode(source.failureCode) ?? 'WORKER_SETUP_FAILED';
  }

  assertPayloadSize(normalized);
  return normalized;
}

export function normalizeBaselineCaptureEventPayload(
  eventType: string,
  value: unknown = {},
): Record<string, unknown> {
  const metadata = CAPTURE_EVENT_META[eventType];
  if (!metadata) throw new FaultRunEventContractError(`UNSUPPORTED_CAPTURE_EVENT:${eventType}`);
  const source = asRecord(value);
  const normalized: Record<string, unknown> = {
    schemaVersion: 1,
    source: 'coordinator',
    phase: metadata.phase,
    status: metadata.status,
  };
  copyCounter(source, normalized, 'limitationCount');
  copyCounter(source, normalized, 'failureClassCount');
  if (typeof source.baselineId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source.baselineId)) {
    normalized.baselineId = source.baselineId;
  }
  copyCounter(source, normalized, 'operatorAuditId');
  if (typeof source.captureStatus === 'string'
      && /^(COMPLETE|COMPLETE_WITH_LIMITATIONS|INCOMPLETE|CAPTURE_FAILED)$/.test(source.captureStatus)) {
    normalized.captureStatus = source.captureStatus;
  }
  if (typeof source.requestSummaryAvailable === 'boolean') {
    normalized.requestSummaryAvailable = source.requestSummaryAvailable;
  }
  copyObservationStatus(source, normalized, 'prometheusStatus');
  copyObservationStatus(source, normalized, 'lokiStatus');
  copyObservationStatus(source, normalized, 'tempoStatus');
  copyRetentionStatus(source, normalized, 'retentionStatus');
  copyTimestamp(source, normalized, 'windowStart');
  copyTimestamp(source, normalized, 'windowEnd');
  const failureCode = normalizeFailureCode(source.failureCode);
  if (failureCode) normalized.failureCode = failureCode;
  assertPayloadSize(normalized);
  return normalized;
}

function normalizeResultStatus(value: unknown): 'SUCCESS' | 'FAILED' | 'NOOP' | 'INTERRUPTED' | 'UNKNOWN' {
  return value === 'SUCCESS' || value === 'FAILED' || value === 'NOOP' || value === 'INTERRUPTED'
    ? value : 'UNKNOWN';
}

function normalizeFailureCode(value: unknown): string | null {
  return typeof value === 'string' && FAILURE_CODES.has(value) ? value : null;
}

function copyCounter(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = source[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) target[key] = value;
}

function copyLatency(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) target[key] = value;
}

function copyStableText(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
  fallback: string,
): void {
  const value = source[key];
  target[key] = typeof value === 'string' && /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(value)
    ? value : fallback;
}

function copyObservationStatus(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (value === 'AVAILABLE' || value === 'PARTIAL' || value === 'UNAVAILABLE' || value === 'UNKNOWN') {
    target[key] = value;
  }
}

function copyRetentionStatus(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (value === 'CHECKED' || value === 'PARTIAL' || value === 'UNAVAILABLE' || value === 'UNKNOWN') {
    target[key] = value;
  }
}

function copyTimestamp(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
      && !Number.isNaN(Date.parse(value))) {
    target[key] = value;
  }
}

function normalizeCacheResults(value: unknown): Record<string, number> | null {
  const source = asRecord(value);
  const keys = [
    'CACHE_HIT',
    'CACHE_MISS_DB_FALLBACK',
    'CACHE_INVALID_FALLBACK',
    'CACHE_BACKEND_ERROR',
    'CACHE_UNKNOWN',
  ];
  const result: Record<string, number> = {};
  for (const key of keys) {
    const count = source[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
    result[key] = count;
  }
  return result;
}

function normalizeCacheResult(value: unknown): string | null {
  return typeof value === 'string' && [
    'CACHE_HIT',
    'CACHE_MISS_DB_FALLBACK',
    'CACHE_INVALID_FALLBACK',
    'CACHE_BACKEND_ERROR',
    'CACHE_UNKNOWN',
  ].includes(value) ? value : null;
}

function assertPayloadSize(value: Record<string, unknown>): void {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new FaultRunEventContractError('SUMMARY_PAYLOAD_TOO_LARGE');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
