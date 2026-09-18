import type { FaultRunState } from './fault-run-catalog';
import { MAX_FAULT_RUN_EVENT_PAYLOAD_BYTES } from './fault-run-event-policy';

export const SAFE_RUNTIME_RECOVERY_SCHEMA_VERSION = 'safe-runtime.v1' as const;
export const MAX_FAULT_RUN_RECOVERY_PROJECTION_BYTES = MAX_FAULT_RUN_EVENT_PAYLOAD_BYTES;

export const FAULT_RUN_STOP_REASONS = [
  'MANUAL',
  'EXPIRED',
  'WORKER_FAILED',
  'WORKER_SHUTDOWN',
  'CONTROL_PLANE_RESTART',
  'SERVICE_UNAVAILABLE',
] as const;

export const FAULT_RUN_RECOVERY_PHASES = [
  'NONE',
  'STOP_REQUESTED',
  'DRAINING',
  'RELEASING',
  'VERIFYING',
  'MANUAL_CLEANUP_REQUIRED',
  'CLEANING',
  'NON_RELEASING_ACTIVE',
  'PARTIAL_RECOVERY',
  'COMPLETED',
] as const;

export const FAULT_RUN_RECOVERY_OUTCOMES = [
  'PENDING',
  'SUCCEEDED',
  'PARTIAL_RECOVERY',
  'DRAIN_TIMEOUT',
  'WORKER_FAILED',
  'RELEASE_FAILED',
  'CLEANUP_FAILED',
  'VERIFY_UNAVAILABLE',
  'VERIFY_FAILED',
  'MANUAL_CLEANUP_REQUIRED',
  'NON_RELEASING_ACTIVE',
  'SERVICE_UNAVAILABLE',
] as const;

export const FAULT_RUN_RECOVERY_STEP_STATUSES = [
  'NOT_STARTED',
  'RUNNING',
  'SUCCEEDED',
  'TIMED_OUT',
  'FAILED',
  'SKIPPED',
  'NOT_APPLICABLE',
  'MANUAL_REQUIRED',
  'NOT_CONFIGURED',
] as const;

export const FAULT_RUN_RECOVERY_ERROR_STAGES = [
  'DRAIN',
  'RELEASE',
  'CLEANUP',
  'VERIFY',
] as const;

export const FAULT_RUN_RECOVERY_ERROR_CODES = [
  'DRAIN_PARTICIPANT_MISSING',
  'DRAIN_TIMEOUT',
  'DRAIN_ABORT_FAILED',
  'DRAIN_FAILED',
  'WORKER_FAILED',
  'TARGET_RELEASE_TIMEOUT',
  'TARGET_RELEASE_UNAVAILABLE',
  'TARGET_RELEASE_REJECTED',
  'TARGET_RELEASE_FAILED',
  'MANUAL_CLEANUP_REQUIRED',
  'CLEANUP_OPERATION_FAILED',
  'VERIFY_UNAVAILABLE',
  'VERIFY_FAILED',
] as const;

export const FAULT_RUN_DRAIN_PARTICIPANT_KINDS = [
  'REPORT',
  'SURGE',
  'SCENARIO',
  'RUNNER',
] as const;

export const FAULT_RUN_RECOVERY_RESIDUAL_KINDS = [
  'DRAIN_UNCERTAIN',
  'MANUAL_CLEANUP_PENDING',
  'NON_RELEASING_EFFECT',
  'SERVICE_RECOVERY_REQUIRED',
  'VERIFICATION_UNAVAILABLE',
] as const;

export const FAULT_RUN_RECOVERY_RESPONSIBILITIES = [
  'CONTROL_PLANE',
  'OPERATOR',
  'SERVICE_OWNER',
] as const;

export const FAULT_RUN_RECOVERY_NEXT_ACTIONS = [
  'RETRY_RECOVERY',
  'INVESTIGATE_DRAIN',
  'COMPLETE_MANUAL_CLEANUP',
  'WAIT_FOR_SERVICE_RECOVERY',
  'CONFIGURE_VERIFICATION',
] as const;

export type FaultRunStopReason = typeof FAULT_RUN_STOP_REASONS[number];
export type FaultRunRecoveryPhase = typeof FAULT_RUN_RECOVERY_PHASES[number];
export type FaultRunRecoveryOutcome = typeof FAULT_RUN_RECOVERY_OUTCOMES[number];
export type FaultRunRecoveryStepStatus = typeof FAULT_RUN_RECOVERY_STEP_STATUSES[number];
export type FaultRunRecoveryErrorStage = typeof FAULT_RUN_RECOVERY_ERROR_STAGES[number];
export type FaultRunRecoveryErrorCode = typeof FAULT_RUN_RECOVERY_ERROR_CODES[number];
export type FaultRunDrainParticipantKind = typeof FAULT_RUN_DRAIN_PARTICIPANT_KINDS[number];
export type FaultRunRecoveryResidualKind = typeof FAULT_RUN_RECOVERY_RESIDUAL_KINDS[number];
export type FaultRunRecoveryResponsibility = typeof FAULT_RUN_RECOVERY_RESPONSIBILITIES[number];
export type FaultRunRecoveryNextAction = typeof FAULT_RUN_RECOVERY_NEXT_ACTIONS[number];

export interface FaultRunRecoveryError {
  stage: FaultRunRecoveryErrorStage;
  code: FaultRunRecoveryErrorCode;
  retryable: boolean;
}

export interface FaultRunRecoveryMetrics {
  participants?: number;
  accepted?: number;
  completed?: number;
  aborted?: number;
  inFlightAtStart?: number;
  inFlightAtDeadline?: number;
  inFlightAtFinish?: number;
}

export interface FaultRunRecoveryStep {
  status: FaultRunRecoveryStepStatus;
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  errorCode?: FaultRunRecoveryErrorCode;
}

export interface FaultRunDrainRecoveryStep extends FaultRunRecoveryStep {
  participantKinds?: readonly FaultRunDrainParticipantKind[];
  metrics?: FaultRunRecoveryMetrics;
}

export interface FaultRunCleanupRecoveryStep extends FaultRunRecoveryStep {
  requestKeyHash?: string;
}

export interface FaultRunRecoveryResidual {
  kind: FaultRunRecoveryResidualKind;
  responsibility: FaultRunRecoveryResponsibility;
  nextAction: FaultRunRecoveryNextAction;
}

export interface FaultRunRecoveryProjection {
  schemaVersion: typeof SAFE_RUNTIME_RECOVERY_SCHEMA_VERSION;
  phase: FaultRunRecoveryPhase;
  outcome: FaultRunRecoveryOutcome;
  stop: {
    reason: FaultRunStopReason;
    requestedAt: string;
    requestKeyHash?: string;
    attempt: number;
  };
  deadlines: {
    drainAt: string;
    recoveryAt: string;
  };
  drain: FaultRunDrainRecoveryStep;
  release: FaultRunRecoveryStep;
  cleanup: FaultRunCleanupRecoveryStep;
  verification: FaultRunRecoveryStep;
  residuals: readonly FaultRunRecoveryResidual[];
  lastError?: FaultRunRecoveryError;
}

export type FaultRunRecoveryProjectionUnknownReason =
  | 'NOT_AN_OBJECT'
  | 'UNKNOWN_SCHEMA'
  | 'INVALID_SHAPE'
  | 'INVALID_INVARIANT'
  | 'TOO_LARGE';

export type FaultRunRecoveryProjectionRead =
  | { kind: 'ABSENT'; projection: null }
  | { kind: 'LEGACY'; projection: null }
  | {
      kind: 'UNKNOWN';
      projection: null;
      reason: FaultRunRecoveryProjectionUnknownReason;
    }
  | {
      kind: 'SAFE_RUNTIME_V1';
      projection: FaultRunRecoveryProjection;
    };

export type FaultRunRecoveryFailureKind =
  | 'ABORTED'
  | 'UNAVAILABLE'
  | 'REJECTED'
  | 'MISSING_PARTICIPANT'
  | 'NOT_CONFIGURED'
  | 'WORKER_FAILED'
  | 'UNKNOWN';

export class FaultRunRecoveryContractError extends Error {
  constructor(
    public readonly code: 'RECOVERY_PROJECTION_INVALID' | 'RECOVERY_PROJECTION_TOO_LARGE',
  ) {
    super(code);
    this.name = 'FaultRunRecoveryContractError';
  }
}

export interface CreateInitialFaultRunRecoveryProjectionInput {
  reason: FaultRunStopReason;
  requestedAt: Date | string;
  drainDeadlineAt: Date | string;
  recoveryDeadlineAt: Date | string;
  requestKeyHash?: string;
  attempt?: number;
}

const MAX_ATTEMPT = 99;
const MAX_COUNTER = 2_147_483_647;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SHA_256_HEX = /^[a-f0-9]{64}$/u;

const ERROR_CODES_BY_STAGE: Record<FaultRunRecoveryErrorStage, readonly FaultRunRecoveryErrorCode[]> = {
  DRAIN: [
    'DRAIN_PARTICIPANT_MISSING',
    'DRAIN_TIMEOUT',
    'DRAIN_ABORT_FAILED',
    'DRAIN_FAILED',
    'WORKER_FAILED',
  ],
  RELEASE: [
    'TARGET_RELEASE_TIMEOUT',
    'TARGET_RELEASE_UNAVAILABLE',
    'TARGET_RELEASE_REJECTED',
    'TARGET_RELEASE_FAILED',
  ],
  CLEANUP: [
    'MANUAL_CLEANUP_REQUIRED',
    'CLEANUP_OPERATION_FAILED',
  ],
  VERIFY: [
    'VERIFY_UNAVAILABLE',
    'VERIFY_FAILED',
  ],
};

const COUNTER_FIELDS = [
  'participants',
  'accepted',
  'completed',
  'aborted',
  'inFlightAtStart',
  'inFlightAtDeadline',
  'inFlightAtFinish',
] as const;

const ROOT_FIELDS = [
  'schemaVersion',
  'phase',
  'outcome',
  'stop',
  'deadlines',
  'drain',
  'release',
  'cleanup',
  'verification',
  'residuals',
  'lastError',
] as const;

const STEP_FIELDS = [
  'status',
  'attempt',
  'startedAt',
  'completedAt',
  'errorCode',
] as const;

const DRAIN_STEP_FIELDS = [
  ...STEP_FIELDS,
  'participantKinds',
  'metrics',
] as const;

const CLEANUP_STEP_FIELDS = [
  ...STEP_FIELDS,
  'requestKeyHash',
] as const;

class ProjectionParseError extends Error {
  constructor(public readonly reason: Exclude<FaultRunRecoveryProjectionUnknownReason, 'TOO_LARGE'>) {
    super(reason);
    this.name = 'ProjectionParseError';
  }
}

export function createInitialFaultRunRecoveryProjection(
  input: CreateInitialFaultRunRecoveryProjectionInput,
): FaultRunRecoveryProjection {
  const attempt = input.attempt ?? 1;
  const projection: FaultRunRecoveryProjection = {
    schemaVersion: SAFE_RUNTIME_RECOVERY_SCHEMA_VERSION,
    phase: 'STOP_REQUESTED',
    outcome: 'PENDING',
    stop: {
      reason: input.reason,
      requestedAt: normalizeInputTimestamp(input.requestedAt),
      ...(input.requestKeyHash === undefined ? {} : { requestKeyHash: input.requestKeyHash }),
      attempt,
    },
    deadlines: {
      drainAt: normalizeInputTimestamp(input.drainDeadlineAt),
      recoveryAt: normalizeInputTimestamp(input.recoveryDeadlineAt),
    },
    drain: { status: 'NOT_STARTED', attempt: 0 },
    release: { status: 'NOT_STARTED', attempt: 0 },
    cleanup: { status: 'NOT_STARTED', attempt: 0 },
    verification: { status: 'NOT_STARTED', attempt: 0 },
    residuals: [],
  };

  const parsed = parseFaultRunRecoveryProjection(projection);
  if (parsed.kind !== 'SAFE_RUNTIME_V1') {
    throw new FaultRunRecoveryContractError('RECOVERY_PROJECTION_INVALID');
  }
  return parsed.projection;
}

export function parseFaultRunRecoveryProjection(value: unknown): FaultRunRecoveryProjectionRead {
  if (value === null || value === undefined) return { kind: 'ABSENT', projection: null };

  const source = asRecord(value);
  if (!source) {
    return { kind: 'UNKNOWN', projection: null, reason: 'NOT_AN_OBJECT' };
  }
  if (!hasOwn(source, 'schemaVersion')) return { kind: 'LEGACY', projection: null };
  if (source.schemaVersion !== SAFE_RUNTIME_RECOVERY_SCHEMA_VERSION) {
    return { kind: 'UNKNOWN', projection: null, reason: 'UNKNOWN_SCHEMA' };
  }

  try {
    const projection = parseProjection(source);
    const serialized = JSON.stringify(canonicalProjection(projection));
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FAULT_RUN_RECOVERY_PROJECTION_BYTES) {
      return { kind: 'UNKNOWN', projection: null, reason: 'TOO_LARGE' };
    }
    return { kind: 'SAFE_RUNTIME_V1', projection };
  } catch (error) {
    if (error instanceof ProjectionParseError) {
      return { kind: 'UNKNOWN', projection: null, reason: error.reason };
    }
    throw error;
  }
}

export function serializeFaultRunRecoveryProjection(
  projection: FaultRunRecoveryProjection,
): string {
  const parsed = parseFaultRunRecoveryProjection(projection);
  if (parsed.kind !== 'SAFE_RUNTIME_V1') {
    throw new FaultRunRecoveryContractError('RECOVERY_PROJECTION_INVALID');
  }

  const serialized = JSON.stringify(canonicalProjection(parsed.projection));
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FAULT_RUN_RECOVERY_PROJECTION_BYTES) {
    throw new FaultRunRecoveryContractError('RECOVERY_PROJECTION_TOO_LARGE');
  }
  return serialized;
}

export function sanitizeFaultRunRecoveryError(
  stage: FaultRunRecoveryErrorStage,
  value: unknown,
): FaultRunRecoveryError {
  const kind = failureKindFrom(value);
  const code = recoveryErrorCodeFor(stage, kind);
  return {
    stage,
    code,
    retryable: isRecoveryErrorRetryable(code),
  };
}

export function faultRunRecoveryOutcomePriority(outcome: FaultRunRecoveryOutcome): number {
  return RECOVERY_OUTCOME_PRIORITIES[outcome];
}

export function selectDominantFaultRunRecoveryOutcome(
  outcomes: readonly FaultRunRecoveryOutcome[],
): FaultRunRecoveryOutcome {
  let dominant: FaultRunRecoveryOutcome = 'PENDING';
  for (const outcome of outcomes) {
    if (faultRunRecoveryOutcomePriority(outcome) > faultRunRecoveryOutcomePriority(dominant)) {
      dominant = outcome;
    }
  }
  return dominant;
}

export function faultRunStateSafetyPriority(state: FaultRunState): number {
  return FAULT_RUN_STATE_SAFETY_PRIORITIES[state];
}

export function selectMostRestrictiveFaultRunState(
  states: readonly FaultRunState[],
): FaultRunState | null {
  let mostRestrictive: FaultRunState | null = null;
  for (const state of states) {
    if (mostRestrictive === null
      || faultRunStateSafetyPriority(state) > faultRunStateSafetyPriority(mostRestrictive)) {
      mostRestrictive = state;
    }
  }
  return mostRestrictive;
}

function parseProjection(source: Record<string, unknown>): FaultRunRecoveryProjection {
  assertExactKeys(source, ROOT_FIELDS, ROOT_FIELDS.filter((key) => key !== 'lastError'));
  const stop = requireRecord(source.stop);
  const deadlines = requireRecord(source.deadlines);

  assertExactKeys(stop, ['reason', 'requestedAt', 'requestKeyHash', 'attempt'], [
    'reason',
    'requestedAt',
    'attempt',
  ]);
  assertExactKeys(deadlines, ['drainAt', 'recoveryAt'], ['drainAt', 'recoveryAt']);

  const projection: FaultRunRecoveryProjection = {
    schemaVersion: SAFE_RUNTIME_RECOVERY_SCHEMA_VERSION,
    phase: parseEnum(source.phase, FAULT_RUN_RECOVERY_PHASES),
    outcome: parseEnum(source.outcome, FAULT_RUN_RECOVERY_OUTCOMES),
    stop: {
      reason: parseEnum(stop.reason, FAULT_RUN_STOP_REASONS),
      requestedAt: parseTimestamp(stop.requestedAt),
      ...(hasOwn(stop, 'requestKeyHash') ? { requestKeyHash: parseRequestKeyHash(stop.requestKeyHash) } : {}),
      attempt: parseInteger(stop.attempt, 1, MAX_ATTEMPT),
    },
    deadlines: {
      drainAt: parseTimestamp(deadlines.drainAt),
      recoveryAt: parseTimestamp(deadlines.recoveryAt),
    },
    drain: parseStep(source.drain, 'DRAIN', 'DRAIN') as FaultRunDrainRecoveryStep,
    release: parseStep(source.release, 'RELEASE'),
    cleanup: parseStep(source.cleanup, 'CLEANUP', 'CLEANUP') as FaultRunCleanupRecoveryStep,
    verification: parseStep(source.verification, 'VERIFY'),
    residuals: parseResiduals(source.residuals),
    ...(hasOwn(source, 'lastError') ? { lastError: parseRecoveryError(source.lastError) } : {}),
  };

  validateProjectionInvariants(projection);
  return projection;
}

function parseStep(
  value: unknown,
  stage: FaultRunRecoveryErrorStage,
  kind: 'STANDARD' | 'DRAIN' | 'CLEANUP' = 'STANDARD',
): FaultRunRecoveryStep {
  const source = requireRecord(value);
  assertExactKeys(
    source,
    kind === 'DRAIN' ? DRAIN_STEP_FIELDS : kind === 'CLEANUP' ? CLEANUP_STEP_FIELDS : STEP_FIELDS,
    ['status', 'attempt'],
  );

  const status = parseEnum(source.status, FAULT_RUN_RECOVERY_STEP_STATUSES);
  const attempt = parseInteger(source.attempt, 0, MAX_ATTEMPT);
  const startedAt = hasOwn(source, 'startedAt') ? parseTimestamp(source.startedAt) : undefined;
  const completedAt = hasOwn(source, 'completedAt') ? parseTimestamp(source.completedAt) : undefined;
  const errorCode = hasOwn(source, 'errorCode')
    ? parseEnum(source.errorCode, FAULT_RUN_RECOVERY_ERROR_CODES)
    : undefined;

  if (errorCode !== undefined && !ERROR_CODES_BY_STAGE[stage].includes(errorCode)) {
    invariantError();
  }

  switch (status) {
    case 'NOT_STARTED':
    case 'NOT_APPLICABLE':
      if (attempt !== 0 || startedAt !== undefined || completedAt !== undefined || errorCode !== undefined) {
        invariantError();
      }
      break;
    case 'MANUAL_REQUIRED':
      if (attempt !== 0 || startedAt !== undefined || completedAt !== undefined
        || errorCode !== 'MANUAL_CLEANUP_REQUIRED' || stage !== 'CLEANUP') {
        invariantError();
      }
      break;
    case 'RUNNING':
      if (attempt < 1 || startedAt === undefined || completedAt !== undefined || errorCode !== undefined) {
        invariantError();
      }
      break;
    case 'SUCCEEDED':
    case 'SKIPPED':
      if (attempt < 1 || startedAt === undefined || completedAt === undefined || errorCode !== undefined) {
        invariantError();
      }
      break;
    case 'TIMED_OUT':
    case 'FAILED':
      if (attempt < 1 || startedAt === undefined || completedAt === undefined || errorCode === undefined) {
        invariantError();
      }
      break;
    case 'NOT_CONFIGURED':
      if (stage !== 'VERIFY' || attempt < 1 || startedAt === undefined || completedAt === undefined
        || errorCode !== 'VERIFY_UNAVAILABLE') {
        invariantError();
      }
      break;
  }

  const step: FaultRunRecoveryStep = {
    status,
    attempt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };

  if (kind === 'STANDARD') return step;
  if (kind === 'CLEANUP') {
    const requestKeyHash = hasOwn(source, 'requestKeyHash')
      ? parseRequestKeyHash(source.requestKeyHash)
      : undefined;
    if (requestKeyHash !== undefined && status !== 'RUNNING') invariantError();
    return {
      ...step,
      ...(requestKeyHash === undefined ? {} : { requestKeyHash }),
    };
  }
  const participantKinds = hasOwn(source, 'participantKinds')
    ? parseParticipantKinds(source.participantKinds)
    : undefined;
  const metrics = hasOwn(source, 'metrics') ? parseMetrics(source.metrics) : undefined;
  if ((status === 'NOT_STARTED' || status === 'NOT_APPLICABLE') && (participantKinds || metrics)) {
    invariantError();
  }
  return {
    ...step,
    ...(participantKinds === undefined ? {} : { participantKinds }),
    ...(metrics === undefined ? {} : { metrics }),
  };
}

function parseParticipantKinds(value: unknown): readonly FaultRunDrainParticipantKind[] {
  if (!Array.isArray(value) || value.length > FAULT_RUN_DRAIN_PARTICIPANT_KINDS.length) {
    shapeError();
  }
  const participantKinds = value.map((item) => parseEnum(item, FAULT_RUN_DRAIN_PARTICIPANT_KINDS));
  if (new Set(participantKinds).size !== participantKinds.length) invariantError();
  return participantKinds;
}

function parseMetrics(value: unknown): FaultRunRecoveryMetrics {
  const source = requireRecord(value);
  assertExactKeys(source, COUNTER_FIELDS, []);
  const metrics: FaultRunRecoveryMetrics = {};
  for (const field of COUNTER_FIELDS) {
    if (hasOwn(source, field)) {
      metrics[field] = parseInteger(source[field], 0, MAX_COUNTER);
    }
  }
  if (Object.keys(metrics).length === 0) invariantError();
  return metrics;
}

function parseResiduals(value: unknown): readonly FaultRunRecoveryResidual[] {
  if (!Array.isArray(value) || value.length > 4) shapeError();
  const residuals = value.map((item) => {
    const source = requireRecord(item);
    assertExactKeys(source, ['kind', 'responsibility', 'nextAction'], [
      'kind',
      'responsibility',
      'nextAction',
    ]);
    return {
      kind: parseEnum(source.kind, FAULT_RUN_RECOVERY_RESIDUAL_KINDS),
      responsibility: parseEnum(source.responsibility, FAULT_RUN_RECOVERY_RESPONSIBILITIES),
      nextAction: parseEnum(source.nextAction, FAULT_RUN_RECOVERY_NEXT_ACTIONS),
    };
  });
  if (new Set(residuals.map(({ kind }) => kind)).size !== residuals.length) invariantError();
  return residuals;
}

function parseRecoveryError(value: unknown): FaultRunRecoveryError {
  const source = requireRecord(value);
  assertExactKeys(source, ['stage', 'code', 'retryable'], ['stage', 'code', 'retryable']);
  const stage = parseEnum(source.stage, FAULT_RUN_RECOVERY_ERROR_STAGES);
  const code = parseEnum(source.code, FAULT_RUN_RECOVERY_ERROR_CODES);
  if (!ERROR_CODES_BY_STAGE[stage].includes(code) || typeof source.retryable !== 'boolean') {
    invariantError();
  }
  if (source.retryable !== isRecoveryErrorRetryable(code)) invariantError();
  return { stage, code, retryable: source.retryable };
}

function validateProjectionInvariants(projection: FaultRunRecoveryProjection): void {
  const requestedAt = Date.parse(projection.stop.requestedAt);
  const drainAt = Date.parse(projection.deadlines.drainAt);
  const recoveryAt = Date.parse(projection.deadlines.recoveryAt);
  if (requestedAt > drainAt || drainAt > recoveryAt) invariantError();

  if (projection.lastError) {
    const stepByStage: Record<FaultRunRecoveryErrorStage, FaultRunRecoveryStep> = {
      DRAIN: projection.drain,
      RELEASE: projection.release,
      CLEANUP: projection.cleanup,
      VERIFY: projection.verification,
    };
    if (stepByStage[projection.lastError.stage].errorCode !== projection.lastError.code) {
      invariantError();
    }
  }

  if (projection.phase === 'NONE') {
    if (projection.outcome !== 'PENDING' || projection.residuals.length !== 0 || projection.lastError !== undefined
      || !allStepsHaveStatus(projection, 'NOT_STARTED')) {
      invariantError();
    }
    return;
  }

  if (projection.phase === 'COMPLETED') {
    if (projection.outcome !== 'SUCCEEDED' || projection.verification.status !== 'SUCCEEDED') {
      invariantError();
    }
    return;
  }

  if (projection.outcome === 'SUCCEEDED') invariantError();
  if (projection.phase === 'CLEANING'
    && (projection.outcome !== 'PENDING'
      || projection.cleanup.status !== 'RUNNING'
      || projection.cleanup.requestKeyHash === undefined)) {
    invariantError();
  }
  if (projection.cleanup.requestKeyHash !== undefined && projection.phase !== 'CLEANING') {
    invariantError();
  }

  switch (projection.outcome) {
    case 'PENDING':
      if (!['STOP_REQUESTED', 'DRAINING', 'RELEASING', 'VERIFYING', 'CLEANING'].includes(projection.phase)) {
        invariantError();
      }
      break;
    case 'DRAIN_TIMEOUT':
      if (projection.phase !== 'PARTIAL_RECOVERY' || projection.drain.status !== 'TIMED_OUT'
        || projection.drain.errorCode !== 'DRAIN_TIMEOUT'
        || !hasResidual(projection, 'DRAIN_UNCERTAIN')) {
        invariantError();
      }
      break;
    case 'WORKER_FAILED':
      if (projection.phase !== 'PARTIAL_RECOVERY' || projection.drain.errorCode !== 'WORKER_FAILED'
        || !hasResidual(projection, 'DRAIN_UNCERTAIN')) {
        invariantError();
      }
      break;
    case 'RELEASE_FAILED':
      if (projection.phase !== 'PARTIAL_RECOVERY'
        || !['FAILED', 'TIMED_OUT'].includes(projection.release.status)
        || projection.release.errorCode === undefined) {
        invariantError();
      }
      break;
    case 'CLEANUP_FAILED':
      if (projection.phase !== 'PARTIAL_RECOVERY'
        || !['FAILED', 'TIMED_OUT'].includes(projection.cleanup.status)
        || projection.cleanup.errorCode !== 'CLEANUP_OPERATION_FAILED') {
        invariantError();
      }
      break;
    case 'VERIFY_UNAVAILABLE':
      if (projection.phase !== 'PARTIAL_RECOVERY'
        || projection.verification.status !== 'NOT_CONFIGURED'
        || projection.verification.errorCode !== 'VERIFY_UNAVAILABLE'
        || !hasResidual(projection, 'VERIFICATION_UNAVAILABLE')) {
        invariantError();
      }
      break;
    case 'VERIFY_FAILED':
      if (projection.phase !== 'PARTIAL_RECOVERY'
        || !['FAILED', 'TIMED_OUT'].includes(projection.verification.status)
        || projection.verification.errorCode !== 'VERIFY_FAILED') {
        invariantError();
      }
      break;
    case 'MANUAL_CLEANUP_REQUIRED':
      if (projection.phase !== 'MANUAL_CLEANUP_REQUIRED'
        || projection.cleanup.status !== 'MANUAL_REQUIRED'
        || !hasResidual(projection, 'MANUAL_CLEANUP_PENDING')) {
        invariantError();
      }
      break;
    case 'NON_RELEASING_ACTIVE':
      if (projection.phase !== 'NON_RELEASING_ACTIVE'
        || !hasResidual(projection, 'NON_RELEASING_EFFECT')) {
        invariantError();
      }
      break;
    case 'SERVICE_UNAVAILABLE':
      if (projection.phase !== 'PARTIAL_RECOVERY'
        || !hasResidual(projection, 'SERVICE_RECOVERY_REQUIRED')) {
        invariantError();
      }
      break;
    case 'PARTIAL_RECOVERY':
      if (projection.phase !== 'PARTIAL_RECOVERY') invariantError();
      break;
  }
}

function canonicalProjection(projection: FaultRunRecoveryProjection): Record<string, unknown> {
  return {
    schemaVersion: projection.schemaVersion,
    phase: projection.phase,
    outcome: projection.outcome,
    stop: {
      reason: projection.stop.reason,
      requestedAt: projection.stop.requestedAt,
      ...(projection.stop.requestKeyHash === undefined
        ? {} : { requestKeyHash: projection.stop.requestKeyHash }),
      attempt: projection.stop.attempt,
    },
    deadlines: {
      drainAt: projection.deadlines.drainAt,
      recoveryAt: projection.deadlines.recoveryAt,
    },
    drain: {
      ...canonicalStep(projection.drain),
      ...(projection.drain.participantKinds === undefined
        ? {} : { participantKinds: [...projection.drain.participantKinds] }),
      ...(projection.drain.metrics === undefined
        ? {} : { metrics: canonicalMetrics(projection.drain.metrics) }),
    },
    release: canonicalStep(projection.release),
    cleanup: {
      ...canonicalStep(projection.cleanup),
      ...(projection.cleanup.requestKeyHash === undefined
        ? {} : { requestKeyHash: projection.cleanup.requestKeyHash }),
    },
    verification: canonicalStep(projection.verification),
    residuals: projection.residuals.map((residual) => ({
      kind: residual.kind,
      responsibility: residual.responsibility,
      nextAction: residual.nextAction,
    })),
    ...(projection.lastError === undefined ? {} : {
      lastError: {
        stage: projection.lastError.stage,
        code: projection.lastError.code,
        retryable: projection.lastError.retryable,
      },
    }),
  };
}

function canonicalStep(step: FaultRunRecoveryStep): Record<string, unknown> {
  return {
    status: step.status,
    attempt: step.attempt,
    ...(step.startedAt === undefined ? {} : { startedAt: step.startedAt }),
    ...(step.completedAt === undefined ? {} : { completedAt: step.completedAt }),
    ...(step.errorCode === undefined ? {} : { errorCode: step.errorCode }),
  };
}

function canonicalMetrics(metrics: FaultRunRecoveryMetrics): Record<string, number> {
  const result: Record<string, number> = {};
  for (const field of COUNTER_FIELDS) {
    const value = metrics[field];
    if (value !== undefined) result[field] = value;
  }
  return result;
}

function normalizeInputTimestamp(value: Date | string): string {
  return parseTimestamp(value instanceof Date ? value.toISOString() : value);
}

function failureKindFrom(value: unknown): FaultRunRecoveryFailureKind {
  const source = asRecord(value);
  if (!source) return 'UNKNOWN';
  return parseKnownFailureKind(source.kind);
}

function parseKnownFailureKind(value: unknown): FaultRunRecoveryFailureKind {
  return value === 'ABORTED'
    || value === 'UNAVAILABLE'
    || value === 'REJECTED'
    || value === 'MISSING_PARTICIPANT'
    || value === 'NOT_CONFIGURED'
    || value === 'WORKER_FAILED'
    ? value
    : 'UNKNOWN';
}

function recoveryErrorCodeFor(
  stage: FaultRunRecoveryErrorStage,
  kind: FaultRunRecoveryFailureKind,
): FaultRunRecoveryErrorCode {
  switch (stage) {
    case 'DRAIN':
      if (kind === 'MISSING_PARTICIPANT') return 'DRAIN_PARTICIPANT_MISSING';
      if (kind === 'ABORTED') return 'DRAIN_TIMEOUT';
      if (kind === 'WORKER_FAILED') return 'WORKER_FAILED';
      return 'DRAIN_FAILED';
    case 'RELEASE':
      if (kind === 'ABORTED') return 'TARGET_RELEASE_TIMEOUT';
      if (kind === 'UNAVAILABLE') return 'TARGET_RELEASE_UNAVAILABLE';
      if (kind === 'REJECTED') return 'TARGET_RELEASE_REJECTED';
      return 'TARGET_RELEASE_FAILED';
    case 'CLEANUP':
      return kind === 'NOT_CONFIGURED'
        ? 'MANUAL_CLEANUP_REQUIRED'
        : 'CLEANUP_OPERATION_FAILED';
    case 'VERIFY':
      return kind === 'NOT_CONFIGURED' ? 'VERIFY_UNAVAILABLE' : 'VERIFY_FAILED';
  }
}

function isRecoveryErrorRetryable(code: FaultRunRecoveryErrorCode): boolean {
  return code === 'DRAIN_TIMEOUT'
    || code === 'DRAIN_ABORT_FAILED'
    || code === 'TARGET_RELEASE_TIMEOUT'
    || code === 'TARGET_RELEASE_UNAVAILABLE'
    || code === 'CLEANUP_OPERATION_FAILED'
    || code === 'VERIFY_FAILED';
}

function allStepsHaveStatus(
  projection: FaultRunRecoveryProjection,
  status: FaultRunRecoveryStepStatus,
): boolean {
  return projection.drain.status === status
    && projection.release.status === status
    && projection.cleanup.status === status
    && projection.verification.status === status;
}

function hasResidual(projection: FaultRunRecoveryProjection, kind: FaultRunRecoveryResidualKind): boolean {
  return projection.residuals.some((residual) => residual.kind === kind);
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    shapeError();
  }
  return new Date(value).toISOString();
}

function parseRequestKeyHash(value: unknown): string {
  if (typeof value !== 'string' || !SHA_256_HEX.test(value)) shapeError();
  return value;
}

function parseInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    shapeError();
  }
  return value;
}

function parseEnum<T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) shapeError();
  return value as T[number];
}

function requireRecord(value: unknown): Record<string, unknown> {
  const source = asRecord(value);
  if (!source) shapeError();
  return source;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertExactKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  if (Object.keys(source).some((key) => !allowed.includes(key))
    || required.some((key) => !hasOwn(source, key))) {
    shapeError();
  }
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function shapeError(): never {
  throw new ProjectionParseError('INVALID_SHAPE');
}

function invariantError(): never {
  throw new ProjectionParseError('INVALID_INVARIANT');
}

const RECOVERY_OUTCOME_PRIORITIES: Record<FaultRunRecoveryOutcome, number> = {
  PENDING: 0,
  SUCCEEDED: 10,
  PARTIAL_RECOVERY: 20,
  DRAIN_TIMEOUT: 60,
  RELEASE_FAILED: 70,
  CLEANUP_FAILED: 80,
  VERIFY_UNAVAILABLE: 90,
  WORKER_FAILED: 100,
  VERIFY_FAILED: 110,
  MANUAL_CLEANUP_REQUIRED: 120,
  NON_RELEASING_ACTIVE: 130,
  SERVICE_UNAVAILABLE: 140,
};

const FAULT_RUN_STATE_SAFETY_PRIORITIES: Record<FaultRunState, number> = {
  RECOVERING: 700,
  CREATING: 600,
  ACTIVE: 500,
  SERVICE_UNAVAILABLE: 400,
  FAILED: 300,
  STOPPED: 200,
  RECOVERED: 100,
};
