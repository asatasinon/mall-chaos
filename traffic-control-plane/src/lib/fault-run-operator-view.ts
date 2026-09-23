import {
  FaultRunValidationError,
  getScenarioDefinition,
  validateScenarioParameters,
  type FaultRunState,
} from './fault-run-catalog';
import {
  normalizeFaultRunRecoveryEventPayload,
  normalizeFaultRunSummaryEventPayload,
  SAFE_RUNTIME_RECOVERY_EVENT_TYPES,
} from './fault-run-event-contract';
import {
  parseFaultRunRecoveryProjection,
  type FaultRunCleanupRecoveryStep,
  type FaultRunRecoveryProjection,
  type FaultRunRecoveryProjectionUnknownReason,
} from './fault-run-recovery';
import {
  parseNotificationRestartSummary,
  summarizeNotificationRestartResult,
  type NotificationRestartSummary,
} from './notification-restart-broker';
import type {
  FaultRunAuditRecord,
  FaultRunEventRecord,
  FaultRunRecord,
  FaultRunTargetSummary,
} from './fault-run-repository';
import type { FaultRunActionRecord } from './fault-run-action-repository';
import type { FaultRunExecutionRecord } from './fault-run-execution-repository';

const CACHE_RESULT_KEYS = [
  'CACHE_HIT',
  'CACHE_MISS_DB_FALLBACK',
  'CACHE_INVALID_FALLBACK',
  'CACHE_BACKEND_ERROR',
  'CACHE_UNKNOWN',
] as const;

const FAULT_RUN_STATES: readonly FaultRunState[] = [
  'CREATING',
  'ACTIVE',
  'RECOVERING',
  'RECOVERED',
  'STOPPED',
  'FAILED',
  'SERVICE_UNAVAILABLE',
];

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type FaultRunRecoveryProjectionView = Omit<
  FaultRunRecoveryProjection,
  'stop' | 'cleanup'
> & {
  stop: Omit<FaultRunRecoveryProjection['stop'], 'requestKeyHash'>;
  cleanup: Omit<FaultRunCleanupRecoveryStep, 'requestKeyHash'>;
};

export type FaultRunRecoveryView =
  | { kind: 'ABSENT'; projection: null }
  | { kind: 'LEGACY'; projection: null }
  | {
      kind: 'UNKNOWN';
      projection: null;
      reason: FaultRunRecoveryProjectionUnknownReason;
    }
  | {
      kind: 'SAFE_RUNTIME_V1';
      projection: FaultRunRecoveryProjectionView;
    };

export interface FaultRunOperatorRun {
  faultRunId: string;
  scenario: string;
  targetService: string;
  targetOperation: string;
  state: FaultRunState;
  parameters: Record<string, number | string>;
  parameterStatus: 'VALIDATED' | 'LEGACY' | 'UNKNOWN';
  parameterIssue: string | null;
  startedAt: string | null;
  expiresAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  recovery: FaultRunRecoveryView;
  manualCleanup: 'UNAVAILABLE' | 'SAFE_COMMAND' | 'LEGACY_TERMINAL';
  createdAt: string;
  updatedAt: string;
  operatorAuditId: number | null;
  execution: FaultRunExecutionView | null;
}

export interface FaultRunExecutionView {
  mode: FaultRunExecutionRecord['executionMode'];
  ownerId: string | null;
  ownerEpoch: number;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  leaseLostAt: string | null;
  reconciledAt: string | null;
  takeoverCount: number;
  reconciliationState: FaultRunExecutionRecord['reconciliationState'];
  drainState: FaultRunExecutionRecord['drainState'];
  drainDeadlineAt: string | null;
  lastAction: string | null;
  lastErrorCode: string | null;
}

export interface FaultRunOperatorAction {
  actionId: string;
  actionType: FaultRunActionRecord['actionType'];
  attemptNo: number;
  actionState: FaultRunActionRecord['actionState'];
  requestedBy: FaultRunActionRecord['requestedBy'];
  dispatchOwnerId: string | null;
  dispatchOwnerEpoch: number | null;
  requestedAt: string;
  dispatchStartedAt: string | null;
  completedAt: string | null;
  resultSummary: Record<string, boolean | number | string> | null;
  errorCode: string | null;
}

export interface FaultRunOperatorViewOptions {
  safeRuntimeEnabled: boolean;
}

export interface FaultRunOperatorEvent {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface FaultRunOperatorAudit {
  id: number;
  operatorId: number | null;
  action: string;
  target: string | null;
  result: 'SUCCESS' | 'FAILURE';
  createdAt: string;
}

export interface FaultRunOperatorDetails {
  run: FaultRunOperatorRun;
  events: FaultRunOperatorEvent[];
  audit: FaultRunOperatorAudit | null;
  audits: FaultRunOperatorAudit[];
  actions: FaultRunOperatorAction[];
}

export function buildFaultRunOperatorRun(
  run: FaultRunRecord,
  options: FaultRunOperatorViewOptions = { safeRuntimeEnabled: false },
): FaultRunOperatorRun {
  const definition = getScenarioDefinition(run.scenario);
  if (!(FAULT_RUN_STATES as readonly string[]).includes(run.state)) {
    throw new Error('FAULT_RUN_STATE_INVALID');
  }
  const recovery = buildFaultRunRecoveryView(run.recoveryResult);
  const parameterReadModel = readParameters(run);
  return {
    faultRunId: run.faultRunId,
    scenario: definition.scenario,
    targetService: definition.targetService,
    targetOperation: definition.targetOperation,
    state: run.state,
    parameters: parameterReadModel.parameters,
    parameterStatus: parameterReadModel.status,
    parameterIssue: parameterReadModel.issue,
    startedAt: run.startedAt,
    expiresAt: run.expiresAt,
    stoppedAt: run.stoppedAt,
    stopReason: safeStopReason(run.stopReason),
    recovery,
    manualCleanup: manualCleanupAvailability(run, recovery, options),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    operatorAuditId: run.operatorAuditId,
    execution: buildFaultRunExecutionView(run.execution),
  };
}

export function buildFaultRunRecoveryView(value: unknown): FaultRunRecoveryView {
  const parsed = parseFaultRunRecoveryProjection(value);
  if (parsed.kind !== 'SAFE_RUNTIME_V1') return parsed;
  const { projection } = parsed;
  return {
    kind: 'SAFE_RUNTIME_V1',
    projection: {
      ...projection,
      stop: {
        reason: projection.stop.reason,
        requestedAt: projection.stop.requestedAt,
        attempt: projection.stop.attempt,
      },
      cleanup: {
        status: projection.cleanup.status,
        attempt: projection.cleanup.attempt,
        ...(projection.cleanup.startedAt === undefined ? {} : { startedAt: projection.cleanup.startedAt }),
        ...(projection.cleanup.completedAt === undefined ? {} : { completedAt: projection.cleanup.completedAt }),
        ...(projection.cleanup.errorCode === undefined ? {} : { errorCode: projection.cleanup.errorCode }),
      },
    },
  };
}

export function buildFaultRunOperatorDetails(
  run: FaultRunRecord,
  events: FaultRunEventRecord[],
  audit: FaultRunAuditRecord | null,
  audits: FaultRunAuditRecord[],
  options: FaultRunOperatorViewOptions = { safeRuntimeEnabled: false },
  actions: FaultRunActionRecord[] = [],
): FaultRunOperatorDetails {
  return {
    run: buildFaultRunOperatorRun(run, options),
    events: events.map((event) => buildFaultRunOperatorEvent(run, event)),
    audit: audit ? buildFaultRunOperatorAudit(audit) : null,
    audits: audits.map(buildFaultRunOperatorAudit),
    actions: actions.map(buildFaultRunOperatorAction),
  };
}

export function buildFaultRunExecutionView(
  execution: FaultRunExecutionRecord | null | undefined,
): FaultRunExecutionView | null {
  if (!execution) return null;
  return {
    mode: execution.executionMode,
    ownerId: execution.ownerId,
    ownerEpoch: execution.ownerEpoch,
    leaseAcquiredAt: execution.leaseAcquiredAt,
    leaseExpiresAt: execution.leaseExpiresAt,
    lastHeartbeatAt: execution.lastHeartbeatAt,
    leaseLostAt: execution.leaseLostAt,
    reconciledAt: execution.reconciledAt,
    takeoverCount: Math.max(execution.ownerEpoch - 1, 0),
    reconciliationState: execution.reconciliationState,
    drainState: execution.drainState,
    drainDeadlineAt: execution.drainDeadlineAt,
    lastAction: execution.lastAction,
    lastErrorCode: execution.lastErrorCode,
  };
}

export function buildFaultRunOperatorAction(
  action: FaultRunActionRecord,
): FaultRunOperatorAction {
  return {
    actionId: action.actionId,
    actionType: action.actionType,
    attemptNo: action.attemptNo,
    actionState: action.actionState,
    requestedBy: action.requestedBy,
    dispatchOwnerId: action.dispatchOwnerId,
    dispatchOwnerEpoch: action.dispatchOwnerEpoch,
    requestedAt: action.requestedAt,
    dispatchStartedAt: action.dispatchStartedAt,
    completedAt: action.completedAt,
    resultSummary: action.resultSummary && typeof action.resultSummary === 'object'
      && !Array.isArray(action.resultSummary)
      ? action.resultSummary as Record<string, boolean | number | string>
      : null,
    errorCode: action.errorCode,
  };
}

export function buildFaultRunOperatorEvent(
  run: FaultRunRecord,
  event: FaultRunEventRecord,
): FaultRunOperatorEvent {
  return {
    id: event.id,
    eventType: event.eventType,
    payload: sanitizeFaultRunEventPayload(run, event),
    createdAt: event.createdAt,
  };
}

export function buildFaultRunOperatorAudit(audit: FaultRunAuditRecord): FaultRunOperatorAudit {
  return {
    id: audit.id,
    operatorId: audit.operatorId,
    action: audit.action,
    target: audit.target,
    result: audit.result,
    createdAt: audit.createdAt,
  };
}

export { summarizeNotificationRestartResult, type NotificationRestartSummary };

function readParameters(run: FaultRunRecord): {
  parameters: Record<string, number | string>;
  status: FaultRunOperatorRun['parameterStatus'];
  issue: string | null;
} {
  try {
    return {
      parameters: validateScenarioParameters(run.scenario, run.parameters),
      status: 'VALIDATED',
      issue: null,
    };
  } catch (error) {
    if (error instanceof FaultRunValidationError) {
      return {
        parameters: sanitizeHistoricalParameters(run),
        status: 'LEGACY',
        issue: safeParameterIssue(error.message),
      };
    }
    return {
      parameters: sanitizeHistoricalParameters(run),
      status: 'UNKNOWN',
      issue: 'UNKNOWN_PARAMETER_STATE',
    };
  }
}

function sanitizeHistoricalParameters(run: FaultRunRecord): Record<string, number | string> {
  const definition = getScenarioDefinition(run.scenario);
  const allowed = new Map(definition.parameters.map((parameter) => [parameter.name, parameter]));
  const source = asRecord(run.parameters);
  const parameters: Record<string, number | string> = {};
  for (const [name, value] of Object.entries(source)) {
    const definitionParameter = allowed.get(name);
    if (!definitionParameter) continue;
    if (typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value)) {
      parameters[name] = value;
      continue;
    }
    if (typeof value === 'string'
      && value.length <= (definitionParameter.maxLength ?? 256)
      && !/[\u0000-\u001f\u007f]/.test(value)) {
      parameters[name] = value;
    }
  }
  return parameters;
}

function safeParameterIssue(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,127}(?::[A-Za-z][A-Za-z0-9_]{0,127})?$/.test(value)
    ? value
    : 'UNKNOWN_PARAMETER_STATE';
}

function manualCleanupAvailability(
  run: FaultRunRecord,
  recovery: FaultRunRecoveryView,
  options: FaultRunOperatorViewOptions,
): FaultRunOperatorRun['manualCleanup'] {
  const definition = getScenarioDefinition(run.scenario);
  if (options.safeRuntimeEnabled) {
    return definition.recoveryPolicy.cleanup === 'OPERATOR_CONFIRMED'
      && recovery.kind === 'SAFE_RUNTIME_V1'
      && recovery.projection.phase === 'MANUAL_CLEANUP_REQUIRED'
      && recovery.projection.outcome === 'MANUAL_CLEANUP_REQUIRED'
      && recovery.projection.cleanup.status === 'MANUAL_REQUIRED'
      ? 'SAFE_COMMAND'
      : 'UNAVAILABLE';
  }
  return definition.allowManualCleanup && (run.state === 'RECOVERED' || run.state === 'STOPPED')
    ? 'LEGACY_TERMINAL'
    : 'UNAVAILABLE';
}

function safeStopReason(value: string | null): string | null {
  return value !== null && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : null;
}

function sanitizeFaultRunEventPayload(
  run: FaultRunRecord,
  event: FaultRunEventRecord,
): Record<string, unknown> {
  if (event.eventType === 'ACTION_OUTCOME_UNKNOWN') {
    return { reason: 'OUTCOME_UNKNOWN' };
  }
  if ((SAFE_RUNTIME_RECOVERY_EVENT_TYPES as readonly string[]).includes(event.eventType)) {
    try {
      return normalizeFaultRunRecoveryEventPayload(
        event.eventType as typeof SAFE_RUNTIME_RECOVERY_EVENT_TYPES[number],
        event.payload,
      );
    } catch {
      return {};
    }
  }

  try {
    return normalizeFaultRunSummaryEventPayload(event.eventType, event.payload);
  } catch {
    // Legacy events have no shared contract. Only retain their narrow, typed summaries below.
  }

  const payload = asRecord(event.payload);
  if (event.eventType === 'TARGET_CONFIRMED') {
    const targetSummary = sanitizeCatalogHashTargetSummary(run, payload.targetSummary);
    return {
      ...(payload.targetService === getScenarioDefinition(run.scenario).targetService
        ? { targetService: payload.targetService }
        : {}),
      ...(targetSummary === undefined ? {} : { targetSummary }),
    };
  }
  if (event.eventType === 'RECOVERY_COMPLETED') {
    const cleanup = sanitizeLegacyCleanup(payload);
    const workerDrain = sanitizeLegacyDrain(payload.workerDrain);
    return {
      ...(cleanup === undefined ? {} : { cleanup }),
      ...(workerDrain === undefined ? {} : { workerDrain }),
    };
  }
  if (event.eventType === 'MANUAL_CLEANUP_COMPLETED') {
    const cleanup = sanitizeLegacyCleanup(payload);
    return cleanup === undefined ? {} : { cleanup };
  }
  if (event.eventType === 'NOTIFICATION_RESTART_COMPLETED') {
    const result = sanitizeNotificationRestartEvent(payload.result);
    return result === undefined ? {} : { result };
  }
  return {};
}

function sanitizeCatalogHashTargetSummary(
  run: FaultRunRecord,
  value: unknown,
): FaultRunTargetSummary | undefined {
  if (run.scenario !== 'CATALOG_REDIS_LARGE_VALUE') return undefined;
  const candidate = asRecord(value);
  const rawMemberSkus = Array.isArray(candidate.memberSkus) ? candidate.memberSkus : [];
  const memberSkus = rawMemberSkus.filter(
    (sku): sku is string => typeof sku === 'string' && SKU_PATTERN.test(sku),
  );
  const expectedHashKey = `catalog:product-detail:operation:${run.faultRunId}`;
  if (candidate.layout !== 'HASH'
    || candidate.hashKey !== expectedHashKey
    || !safeInteger(candidate.memberCount, 1, 47)
    || memberSkus.length !== candidate.memberCount
    || memberSkus.some((sku, index) => sku !== rawMemberSkus[index])
    || new Set(memberSkus).size !== memberSkus.length
    || typeof candidate.probeSku !== 'string'
    || !SKU_PATTERN.test(candidate.probeSku)
    || memberSkus.includes(candidate.probeSku)
    || !safeInteger(candidate.memberSizeBytes, 1024, 128 * 1024 * 1024)
    || !safeInteger(candidate.logicalBytes, 1, 512 * 1024 * 1024)
    || candidate.logicalBytes !== candidate.memberCount * candidate.memberSizeBytes
    || !safeInteger(candidate.keyTtlSec, 1, 3600)) {
    return undefined;
  }
  const summary: FaultRunTargetSummary = {
    layout: 'HASH',
    hashKey: candidate.hashKey,
    memberCount: candidate.memberCount,
    memberSizeBytes: candidate.memberSizeBytes,
    logicalBytes: candidate.logicalBytes,
    probeSku: candidate.probeSku,
    memberSkus,
    keyTtlSec: candidate.keyTtlSec,
  };
  if (safeInteger(candidate.observedBytes, 1, Number.MAX_SAFE_INTEGER)) {
    summary.observedBytes = candidate.observedBytes;
  }
  if (isTimestamp(candidate.expiresAt)) summary.expiresAt = candidate.expiresAt;
  return summary;
}

function sanitizeLegacyCleanup(value: Record<string, unknown>): {
  hashRemoved?: boolean;
  released?: boolean;
  markerRemoved?: boolean;
} | undefined {
  const cleanup = findCleanupRecord(value);
  if (!cleanup) return undefined;
  const summary = {
    ...(typeof cleanup.hashRemoved === 'boolean' ? { hashRemoved: cleanup.hashRemoved } : {}),
    ...(typeof cleanup.released === 'boolean' ? { released: cleanup.released } : {}),
    ...(typeof cleanup.markerRemoved === 'boolean' ? { markerRemoved: cleanup.markerRemoved } : {}),
  };
  return Object.keys(summary).length === 0 ? undefined : summary;
}

function findCleanupRecord(value: Record<string, unknown>, depth = 0): Record<string, unknown> | undefined {
  if (depth > 3) return undefined;
  if (typeof value.hashRemoved === 'boolean'
    || typeof value.released === 'boolean'
    || typeof value.markerRemoved === 'boolean') {
    return value;
  }
  return findCleanupRecord(asRecord(value.result), depth + 1)
    ?? findCleanupRecord(asRecord(value.data), depth + 1);
}

function sanitizeLegacyDrain(value: unknown): Record<string, unknown> | undefined {
  const drain = asRecord(value);
  if (typeof drain.registered !== 'boolean' || typeof drain.drained !== 'boolean') return undefined;
  const result = sanitizeWorkerStats(drain.result);
  return {
    registered: drain.registered,
    drained: drain.drained,
    ...(result === undefined ? {} : { result }),
  };
}

function sanitizeWorkerStats(value: unknown): Record<string, unknown> | undefined {
  const source = asRecord(value);
  if (!safeInteger(source.requests, 0, Number.MAX_SAFE_INTEGER)
    || !safeInteger(source.successes, 0, Number.MAX_SAFE_INTEGER)
    || !safeInteger(source.failures, 0, Number.MAX_SAFE_INTEGER)
    || !safeInteger(source.timeouts, 0, Number.MAX_SAFE_INTEGER)
    || !safeInteger(source.inFlight, 0, Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  const summary: Record<string, unknown> = {
    requests: source.requests,
    successes: source.successes,
    failures: source.failures,
    timeouts: source.timeouts,
    inFlight: source.inFlight,
  };
  if (typeof source.stopReason === 'string' && /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(source.stopReason)) {
    summary.stopReason = source.stopReason;
  }
  for (const field of ['averageLatencyMs', 'p50LatencyMs', 'p95LatencyMs', 'p99LatencyMs']) {
    if (safeInteger(source[field], 0, Number.MAX_SAFE_INTEGER)) summary[field] = source[field];
  }
  const cacheResults = asRecord(source.cacheResults);
  const safeCacheResults = Object.fromEntries(
    CACHE_RESULT_KEYS.flatMap((key) => safeInteger(cacheResults[key], 0, Number.MAX_SAFE_INTEGER)
      ? [[key, cacheResults[key]]]
      : []),
  );
  if (Object.keys(safeCacheResults).length > 0) summary.cacheResults = safeCacheResults;
  return summary;
}

function sanitizeNotificationRestartEvent(value: unknown): NotificationRestartSummary | undefined {
  try {
    return parseNotificationRestartSummary(value);
  } catch {
    return undefined;
  }
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
