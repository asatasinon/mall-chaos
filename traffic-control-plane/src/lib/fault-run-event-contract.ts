import {
  FAULT_RUN_DRAIN_PARTICIPANT_KINDS,
  FAULT_RUN_RECOVERY_ERROR_CODES,
  FAULT_RUN_RECOVERY_NEXT_ACTIONS,
  FAULT_RUN_RECOVERY_OUTCOMES,
  FAULT_RUN_RECOVERY_RESIDUAL_KINDS,
  FAULT_RUN_RECOVERY_RESPONSIBILITIES,
  FAULT_RUN_STOP_REASONS,
} from './fault-run-recovery';

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

export const SAFE_RUNTIME_RECOVERY_EVENT_TYPES = [
  'STOP_REQUESTED',
  'DRAIN_STARTED',
  'DRAIN_COMPLETED',
  'DRAIN_TIMED_OUT',
  'DRAIN_LATE_COMPLETED',
  'DRAIN_FAILED',
  'RELEASE_STARTED',
  'RELEASE_COMPLETED',
  'RELEASE_FAILED',
  'RELEASE_SKIPPED',
  'MANUAL_CLEANUP_REQUIRED',
  'MANUAL_CLEANUP_REQUESTED',
  'MANUAL_CLEANUP_COMPLETED',
  'MANUAL_CLEANUP_FAILED',
  'NON_RELEASING_RECORDED',
  'VERIFY_COMPLETED',
  'VERIFY_UNAVAILABLE',
  'VERIFY_FAILED',
  'RECOVERY_PARTIAL',
  'RECOVERY_BLOCKED',
  'RECOVERY_COMPLETED',
] as const;

export type FaultRunRecoveryEventType = typeof SAFE_RUNTIME_RECOVERY_EVENT_TYPES[number];

const RECOVERY_EVENT_META: Record<FaultRunRecoveryEventType, {
  phase: 'command' | 'drain' | 'release' | 'cleanup' | 'verification' | 'recovery';
  status: 'REQUESTED' | 'STARTED' | 'COMPLETED' | 'TIMED_OUT' | 'FAILED' | 'SKIPPED' | 'BLOCKED';
}> = {
  STOP_REQUESTED: { phase: 'command', status: 'REQUESTED' },
  DRAIN_STARTED: { phase: 'drain', status: 'STARTED' },
  DRAIN_COMPLETED: { phase: 'drain', status: 'COMPLETED' },
  DRAIN_TIMED_OUT: { phase: 'drain', status: 'TIMED_OUT' },
  DRAIN_LATE_COMPLETED: { phase: 'drain', status: 'COMPLETED' },
  DRAIN_FAILED: { phase: 'drain', status: 'FAILED' },
  RELEASE_STARTED: { phase: 'release', status: 'STARTED' },
  RELEASE_COMPLETED: { phase: 'release', status: 'COMPLETED' },
  RELEASE_FAILED: { phase: 'release', status: 'FAILED' },
  RELEASE_SKIPPED: { phase: 'release', status: 'SKIPPED' },
  MANUAL_CLEANUP_REQUIRED: { phase: 'cleanup', status: 'BLOCKED' },
  MANUAL_CLEANUP_REQUESTED: { phase: 'cleanup', status: 'REQUESTED' },
  MANUAL_CLEANUP_COMPLETED: { phase: 'cleanup', status: 'COMPLETED' },
  MANUAL_CLEANUP_FAILED: { phase: 'cleanup', status: 'FAILED' },
  NON_RELEASING_RECORDED: { phase: 'recovery', status: 'BLOCKED' },
  VERIFY_COMPLETED: { phase: 'verification', status: 'COMPLETED' },
  VERIFY_UNAVAILABLE: { phase: 'verification', status: 'BLOCKED' },
  VERIFY_FAILED: { phase: 'verification', status: 'FAILED' },
  RECOVERY_PARTIAL: { phase: 'recovery', status: 'BLOCKED' },
  RECOVERY_BLOCKED: { phase: 'recovery', status: 'BLOCKED' },
  RECOVERY_COMPLETED: { phase: 'recovery', status: 'COMPLETED' },
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

export function normalizeFaultRunRecoveryEventPayload(
  eventType: FaultRunRecoveryEventType,
  value: unknown = {},
): Record<string, unknown> {
  const metadata = RECOVERY_EVENT_META[eventType];
  const source = asRecord(value);
  const normalized: Record<string, unknown> = {
    schemaVersion: 1,
    source: 'safe-runtime',
    phase: metadata.phase,
    status: metadata.status,
  };

  if (eventType === 'STOP_REQUESTED') {
    const reason = source.reason;
    const attempt = source.attempt;
    const drainDeadlineAt = source.drainDeadlineAt;
    const recoveryDeadlineAt = source.recoveryDeadlineAt;
    if (!(FAULT_RUN_STOP_REASONS as readonly unknown[]).includes(reason)
      || !isPositiveCounter(attempt)
      || !isTimestamp(drainDeadlineAt)
      || !isTimestamp(recoveryDeadlineAt)) {
      throw new FaultRunEventContractError('INVALID_RECOVERY_STOP_REQUEST_EVENT');
    }
    normalized.reason = reason;
    normalized.attempt = attempt;
    normalized.drainDeadlineAt = drainDeadlineAt;
    normalized.recoveryDeadlineAt = recoveryDeadlineAt;
    if (reason === 'MANUAL' || source.operatorAuditId !== undefined) {
      copyOperatorAudit(source, normalized, 'FAULT_RUN_STOP');
    }
  } else if (eventType === 'MANUAL_CLEANUP_REQUESTED') {
    if (!isPositiveCounter(source.attempt) || !isPositiveCounter(source.cleanupAttempt)) {
      throw new FaultRunEventContractError('INVALID_MANUAL_CLEANUP_REQUEST_EVENT');
    }
    normalized.attempt = source.attempt;
    normalized.cleanupAttempt = source.cleanupAttempt;
    copyOperatorAudit(source, normalized, 'FAULT_RUN_CLEANUP');
  } else {
    copyCounter(source, normalized, 'attempt');
    copyCounter(source, normalized, 'cleanupAttempt');
    copyCounter(source, normalized, 'participants');
    copyCounter(source, normalized, 'accepted');
    copyCounter(source, normalized, 'completed');
    copyCounter(source, normalized, 'aborted');
    copyCounter(source, normalized, 'inFlightAtStart');
    copyCounter(source, normalized, 'inFlightAtDeadline');
    copyCounter(source, normalized, 'inFlightAtFinish');
    copyTimestamp(source, normalized, 'deadlineAt');
    copyTimestamp(source, normalized, 'completedAt');
    copyRecoveryOperation(source, normalized);
    copyRecoveryParticipant(source, normalized);
    copyRecoveryErrorCode(source, normalized);
    copyRecoveryOutcome(source, normalized);
    copyRecoveryResidual(source, normalized);
    copyRecoveryNextAction(source, normalized);
    copyRecoveryResponsibility(source, normalized);
    if (metadata.phase === 'verification') {
      copyStableText(source, normalized, 'checkId', 'UNKNOWN');
    }
  }

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

function copyOperatorAudit(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  action: 'FAULT_RUN_STOP' | 'FAULT_RUN_CLEANUP',
): void {
  if (!isPositiveCounter(source.operatorAuditId)) {
    throw new FaultRunEventContractError('RECOVERY_AUDIT_ID_REQUIRED');
  }
  target.operatorAuditId = source.operatorAuditId;
  target.auditAction = action;
  target.auditResult = 'SUCCESS';
}

function copyRecoveryOperation(source: Record<string, unknown>, target: Record<string, unknown>): void {
  const operation = source.operation;
  if (typeof operation === 'string' && /^[a-z][a-z0-9-]{0,127}$/.test(operation)) {
    target.operation = operation;
  }
}

function copyRecoveryParticipant(source: Record<string, unknown>, target: Record<string, unknown>): void {
  const participant = source.participant;
  if ((FAULT_RUN_DRAIN_PARTICIPANT_KINDS as readonly unknown[]).includes(participant)) {
    target.participant = participant;
  }
}

function copyRecoveryErrorCode(source: Record<string, unknown>, target: Record<string, unknown>): void {
  const errorCode = source.errorCode;
  if ((FAULT_RUN_RECOVERY_ERROR_CODES as readonly unknown[]).includes(errorCode)) {
    target.errorCode = errorCode;
  }
}

function copyRecoveryOutcome(source: Record<string, unknown>, target: Record<string, unknown>): void {
  const outcome = source.outcome;
  if ((FAULT_RUN_RECOVERY_OUTCOMES as readonly unknown[]).includes(outcome)) {
    target.outcome = outcome;
  }
}

function copyRecoveryResidual(source: Record<string, unknown>, target: Record<string, unknown>): void {
  const residualKind = source.residualKind;
  if ((FAULT_RUN_RECOVERY_RESIDUAL_KINDS as readonly unknown[]).includes(residualKind)) {
    target.residualKind = residualKind;
  }
}

function copyRecoveryNextAction(source: Record<string, unknown>, target: Record<string, unknown>): void {
  const nextAction = source.nextAction;
  if ((FAULT_RUN_RECOVERY_NEXT_ACTIONS as readonly unknown[]).includes(nextAction)) {
    target.nextAction = nextAction;
  }
}

function copyRecoveryResponsibility(source: Record<string, unknown>, target: Record<string, unknown>): void {
  const responsibility = source.responsibility;
  if ((FAULT_RUN_RECOVERY_RESPONSIBILITIES as readonly unknown[]).includes(responsibility)) {
    target.responsibility = responsibility;
  }
}

function isPositiveCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
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
