import {
  getScenarioDefinition,
  type FaultRunRecoveryStrategy,
  type FaultRunScenario,
} from './fault-run-catalog';
import type {
  BaselineCaptureStatus,
  BaselineFailureClass,
  BaselineLifecycle,
  BaselineLimitation,
  BaselineOutcome,
  BaselineRequestSummary,
} from './baseline-schema';
import type { FaultRunEventRecord, FaultRunRecord } from './fault-run-repository';

const EVENT_SOURCE_LIMIT = 64;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_.:-]{0,63}$/;

const CONTROL_FAILURE_EVENTS = new Set([
  'CREATE_FAILED',
  'CREATE_RECOVERY_FAILED',
]);
const WORKER_FAILURE_EVENTS = new Set([
  'SCENARIO_WORKER_SETUP_FAILED',
  'REPORT_WORKER_SETUP_FAILED',
  'SCENARIO_REQUEST_FAILED',
  'REPORT_REQUEST_FAILED',
]);
const RECOVERY_FAILURE_EVENTS = new Set([
  'RECOVERY_FAILED',
  'COMPENSATION_FAILED',
]);
const CLEANUP_FAILURE_EVENTS = new Set(['MANUAL_CLEANUP_FAILED']);

type RuntimeSummaryKind = 'REPORT' | 'SCENARIO' | 'RUNNER' | 'NONE';

export interface BaselineEventSource {
  id: number;
  eventType: string;
  createdAt: string;
}

export interface FoldedBaselineFacts {
  status: Extract<BaselineCaptureStatus, 'COMPLETE' | 'COMPLETE_WITH_LIMITATIONS' | 'INCOMPLETE'>;
  lifecycle: BaselineLifecycle;
  outcome: BaselineOutcome;
  requestSummary: BaselineRequestSummary | null;
  knownLimitations: BaselineLimitation[];
  eventSources: BaselineEventSource[];
}

export function foldBaselineEvents(
  run: FaultRunRecord,
  events: readonly FaultRunEventRecord[],
): FoldedBaselineFacts {
  const orderedEvents = [...events]
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftTime = timestampValue(left.event.createdAt);
      const rightTime = timestampValue(right.event.createdAt);
      if (leftTime !== rightTime) return leftTime - rightTime;
      if (left.event.id !== right.event.id) return left.event.id - right.event.id;
      return left.index - right.index;
    })
    .map(({ event }) => event);
  const eventTypes = new Set(orderedEvents.map((event) => event.eventType));
  const limitations: BaselineLimitation[] = [];
  const sources = new Map<number, BaselineEventSource>();
  const addSource = (event: FaultRunEventRecord): void => {
    if (sources.size >= EVENT_SOURCE_LIMIT || sources.has(event.id)) return;
    sources.set(event.id, {
      id: event.id,
      eventType: event.eventType,
      createdAt: event.createdAt,
    });
  };
  const addLimitation = (code: string, detail: string | null = null): void => {
    if (limitations.some((limitation) => limitation.code === code && limitation.detail === detail)) return;
    limitations.push({ code, detail });
  };

  const createdEvent = findFirst(orderedEvents, 'CREATED');
  const targetConfirmedEvent = findFirst(orderedEvents, 'TARGET_CONFIRMED');
  const recoveryStartedEvent = findFirst(orderedEvents, 'RECOVERY_STARTED');
  const recoveryCompletedEvent = findLast(orderedEvents, 'RECOVERY_COMPLETED');
  const recoveryFailedEvent = findLast(orderedEvents, 'RECOVERY_FAILED');
  const serviceRecoveredEvent = findLast(orderedEvents, 'SERVICE_RECOVERED');
  const manualCleanupCompletedEvent = findLast(orderedEvents, 'MANUAL_CLEANUP_COMPLETED');
  const manualCleanupFailedEvent = findLast(orderedEvents, 'MANUAL_CLEANUP_FAILED');

  for (const event of [
    createdEvent,
    targetConfirmedEvent,
    recoveryStartedEvent,
    recoveryCompletedEvent,
    recoveryFailedEvent,
    serviceRecoveredEvent,
    manualCleanupCompletedEvent,
    manualCleanupFailedEvent,
  ]) {
    if (event) addSource(event);
  }

  const prepareStartedAt = firstTimestamp(
    validTimestamp(run.createdAt),
    timestampFromEvent(createdEvent),
  );
  const activeAt = firstTimestamp(
    validTimestamp(run.startedAt),
    timestampFromEvent(targetConfirmedEvent),
  );
  const stopRequestedAt = timestampFromEvent(recoveryStartedEvent);
  const recoveredAt = firstTimestamp(
    validTimestamp(run.stoppedAt) && (run.state === 'RECOVERED' || run.state === 'STOPPED')
      ? validTimestamp(run.stoppedAt) : null,
    timestampFromEvent(recoveryCompletedEvent),
    timestampFromEvent(serviceRecoveredEvent),
  );
  const strategy = getScenarioDefinition(run.scenario).recoveryStrategy;
  const cleanupFinishedAt = firstTimestamp(
    timestampFromEvent(manualCleanupCompletedEvent),
    strategy === 'NON_RELEASING' ? null : timestampFromEvent(recoveryCompletedEvent),
  );

  const lifecycle: BaselineLifecycle = {
    prepareStartedAt,
    activeAt,
    stopRequestedAt,
    recoveredAt,
    cleanupFinishedAt,
  };

  if (!prepareStartedAt) addLimitation('MISSING_RUNTIME_EVENT', 'CREATED');
  if (!activeAt) addLimitation('MISSING_RUNTIME_EVENT', 'TARGET_CONFIRMED_OR_STARTED_AT');
  if (!stopRequestedAt) addLimitation('MISSING_RUNTIME_EVENT', 'RECOVERY_STARTED');
  if (!recoveryCompletedEvent && !recoveryFailedEvent && !serviceRecoveredEvent) {
    addLimitation('MISSING_RUNTIME_EVENT', 'RECOVERY_COMPLETED_OR_FAILED');
  }

  const runtime = foldRuntimeSummary(run, orderedEvents, addSource, addLimitation);
  if (runtime.requiredEventMissing) {
    addLimitation('MISSING_RUNTIME_EVENT', runtime.requiredEventMissing);
  }

  const failureClasses = new Set<BaselineFailureClass>();
  const failureCodes = new Set<string>();
  for (const event of orderedEvents) {
    const failureClass = classifyFailureEvent(event);
    if (failureClass) {
      failureClasses.add(failureClass);
      addSource(event);
    }
    const code = readFailureCode(event);
    if (code) failureCodes.add(code);
  }
  if (run.state === 'FAILED' && failureClasses.size === 0) {
    failureClasses.add('CONTROL_PLANE_FAILURE');
    addLimitation('FAILURE_CLASS_INFERRED', 'FAILED_WITHOUT_FAILURE_EVENT');
  }
  if (recoveryFailedEvent) addSource(recoveryFailedEvent);
  if (manualCleanupFailedEvent) addSource(manualCleanupFailedEvent);

  const outcome = foldOutcome(
    run,
    strategy,
    eventTypes,
    runtime,
    failureClasses,
    failureCodes,
    recoveryCompletedEvent,
    recoveryFailedEvent,
    serviceRecoveredEvent,
    manualCleanupCompletedEvent,
    manualCleanupFailedEvent,
    addLimitation,
  );

  return {
    status: calculateCaptureStatus(limitations),
    lifecycle,
    outcome,
    requestSummary: runtime.requestSummary,
    knownLimitations: limitations,
    eventSources: [...sources.values()].sort((left, right) => left.id - right.id),
  };
}

function foldRuntimeSummary(
  run: FaultRunRecord,
  events: readonly FaultRunEventRecord[],
  addSource: (event: FaultRunEventRecord) => void,
  addLimitation: (code: string, detail?: string | null) => void,
): {
  kind: RuntimeSummaryKind;
  requestSummary: BaselineRequestSummary | null;
  requiredEventMissing: string | null;
  effectObserved: boolean;
} {
  const definition = getScenarioDefinition(run.scenario);
  if (run.scenario === 'BROWSE_REPORT_SQL' || run.scenario === 'ORDER_REPORT_SQL') {
    const requests = findLast(events, 'REPORT_REQUEST');
    const stopped = findLast(events, 'REPORT_WORKER_STOPPED');
    if (requests) addSource(requests);
    if (stopped) addSource(stopped);
    if (!requests && !stopped) {
      return { kind: 'REPORT', requestSummary: null, requiredEventMissing: 'REPORT_REQUEST_OR_STOPPED', effectObserved: false };
    }
    const requestSummary = buildReportSummary(requests, stopped, addLimitation);
    return {
      kind: 'REPORT',
      requestSummary,
      requiredEventMissing: stopped ? null : 'REPORT_WORKER_STOPPED',
      effectObserved: hasPositiveCounter(requestSummary?.requests),
    };
  }

  if (isScenarioWorkerScenario(run.scenario)) {
    const stopped = findLast(events, 'SCENARIO_WORKER_STOPPED');
    const drained = findLast(events, 'SCENARIO_WORKER_DRAINED');
    const started = findLast(events, 'SCENARIO_WORKER_STARTED');
    if (started) addSource(started);
    if (stopped) addSource(stopped);
    if (!stopped && drained) addSource(drained);
    if (!stopped && !drained) {
      return {
        kind: 'SCENARIO',
        requestSummary: null,
        requiredEventMissing: 'SCENARIO_WORKER_STOPPED',
        effectObserved: false,
      };
    }
    const source = stopped ?? drained!;
    const requestSummary = buildWorkerSummary(source, addLimitation);
    return {
      kind: 'SCENARIO',
      requestSummary,
      requiredEventMissing: stopped ? null : 'SCENARIO_WORKER_STOPPED',
      effectObserved: hasPositiveCounter(requestSummary?.requests),
    };
  }

  if (run.scenario === 'CART_CATALOG_DEPENDENCY') {
    const runtimeEvents = events.filter((event) =>
      event.eventType === 'SCENARIO_WORKER_STOPPED'
      || event.eventType === 'REPORT_WORKER_STOPPED'
      || event.eventType === 'RUNNER_LIFECYCLE_SUMMARY');
    if (runtimeEvents.length === 0) {
      addLimitation('DISPATCH_UNVERIFIED', definition.targetOperation);
      return { kind: 'NONE', requestSummary: null, requiredEventMissing: null, effectObserved: false };
    }
  }

  const lifecycleEvents = events.filter((event) => event.eventType === 'RUNNER_LIFECYCLE_SUMMARY');
  if (lifecycleEvents.length > 0) {
    lifecycleEvents.forEach(addSource);
    return {
      kind: 'RUNNER',
      requestSummary: buildRunnerSummary(lifecycleEvents, addLimitation),
      requiredEventMissing: null,
      effectObserved: true,
    };
  }

  return {
    kind: 'NONE',
    requestSummary: null,
    requiredEventMissing: 'RUNNER_LIFECYCLE_SUMMARY',
    effectObserved: false,
  };
}

function buildReportSummary(
  requestEvent: FaultRunEventRecord | undefined,
  stoppedEvent: FaultRunEventRecord | undefined,
  addLimitation: (code: string, detail?: string | null) => void,
): BaselineRequestSummary | null {
  const request = asRecord(requestEvent?.payload);
  const stopped = asRecord(stoppedEvent?.payload);
  const requests = firstCounter(request.requests, stopped.requests);
  const successes = firstCounter(request.successes, stopped.successes);
  const failures = firstCounter(request.failures, stopped.failures);
  const averageLatencyMs = firstLatency(stopped.averageLatencyMs, request.averageLatencyMs);
  const summary: BaselineRequestSummary = {
    requests,
    successes,
    failures,
    timeouts: null,
    averageLatencyMs,
    p50LatencyMs: null,
    p95LatencyMs: null,
    p99LatencyMs: null,
  };
  validateCounters(summary, 0, addLimitation);
  return summary;
}

function buildWorkerSummary(
  event: FaultRunEventRecord,
  addLimitation: (code: string, detail?: string | null) => void,
): BaselineRequestSummary | null {
  const payload = asRecord(event.payload);
  const summary: BaselineRequestSummary = {
    requests: counterOrNull(payload.requests),
    successes: counterOrNull(payload.successes),
    failures: counterOrNull(payload.failures),
    timeouts: counterOrNull(payload.timeouts),
    averageLatencyMs: latencyOrNull(payload.averageLatencyMs),
    p50LatencyMs: latencyOrNull(payload.p50LatencyMs),
    p95LatencyMs: latencyOrNull(payload.p95LatencyMs),
    p99LatencyMs: latencyOrNull(payload.p99LatencyMs),
  };
  validateCounters(summary, counterOrNull(payload.inFlight), addLimitation);
  return summary;
}

function buildRunnerSummary(
  events: readonly FaultRunEventRecord[],
  addLimitation: (code: string, detail?: string | null) => void,
): BaselineRequestSummary {
  let successes = 0;
  let failures = 0;
  const latencies: number[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    const status = typeof payload.resultStatus === 'string'
      ? payload.resultStatus
      : typeof payload.status === 'string' ? payload.status : null;
    const success = payload.success;
    if (success === true || status === 'SUCCESS') successes++;
    else if (success === false || status === 'FAILED' || status === 'INTERRUPTED') failures++;
    else addLimitation('MISSING_RUNTIME_EVENT', `RUNNER_STATUS:${event.id}`);
    const latency = latencyOrNull(payload.latencyMs);
    if (latency !== null) latencies.push(latency);
  }
  addLimitation('LIFECYCLE_COUNTS_NOT_REQUESTS', null);
  return {
    requests: null,
    successes,
    failures,
    timeouts: null,
    averageLatencyMs: latencies.length > 0
      ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length)
      : null,
    p50LatencyMs: null,
    p95LatencyMs: null,
    p99LatencyMs: null,
  };
}

function foldOutcome(
  run: FaultRunRecord,
  strategy: FaultRunRecoveryStrategy,
  eventTypes: ReadonlySet<string>,
  runtime: { requestSummary: BaselineRequestSummary | null; effectObserved: boolean },
  failureClasses: Set<BaselineFailureClass>,
  failureCodes: Set<string>,
  recoveryCompletedEvent: FaultRunEventRecord | undefined,
  recoveryFailedEvent: FaultRunEventRecord | undefined,
  serviceRecoveredEvent: FaultRunEventRecord | undefined,
  manualCleanupCompletedEvent: FaultRunEventRecord | undefined,
  manualCleanupFailedEvent: FaultRunEventRecord | undefined,
  addLimitation: (code: string, detail?: string | null) => void,
): BaselineOutcome {
  const controlAction: BaselineOutcome['controlAction'] =
    eventTypes.has('TARGET_CONFIRMED')
      ? 'COMPLETED'
      : [...failureClasses].some((failureClass) => failureClass === 'CONTROL_PLANE_FAILURE')
        ? 'FAILED' : 'UNKNOWN';
  const effectObserved: BaselineOutcome['effectObserved'] = runtime.effectObserved
    ? 'OBSERVED'
    : failureClasses.has('TARGET_EFFECT_FAILURE') || failureClasses.has('WORKER_FAILURE')
      ? 'NOT_OBSERVED' : 'UNKNOWN';
  const businessRecovered: BaselineOutcome['businessRecovered'] =
    serviceRecoveredEvent
      ? 'YES'
      : recoveryFailedEvent || run.state === 'FAILED' && eventTypes.has('RECOVERY_FAILED')
        ? 'NO' : 'UNKNOWN';

  let resourceCleanup: BaselineOutcome['resourceCleanup'];
  if (strategy === 'MANUAL_CLEANUP') {
    if (manualCleanupCompletedEvent) resourceCleanup = 'COMPLETED';
    else if (manualCleanupFailedEvent) resourceCleanup = 'FAILED';
    else {
      resourceCleanup = 'MANUAL_REQUIRED';
      failureClasses.add('CLEANUP_FAILURE');
      failureCodes.add('CLEANUP_REQUIRED');
      addLimitation('MANUAL_CLEANUP_REQUIRED', null);
    }
  } else if (strategy === 'NON_RELEASING') {
    resourceCleanup = 'NOT_REQUIRED';
    addLimitation('NON_RELEASING_RESOURCE_BOUNDARY', null);
  } else if (recoveryFailedEvent || failureClasses.has('RECOVERY_FAILURE')) {
    resourceCleanup = 'FAILED';
  } else if (recoveryCompletedEvent) {
    resourceCleanup = 'UNKNOWN';
    addLimitation('CLEANUP_UNVERIFIED', null);
  } else {
    resourceCleanup = 'UNKNOWN';
  }
  if (eventTypes.has('SERVICE_UNAVAILABLE') && !serviceRecoveredEvent) {
    addLimitation('BUSINESS_RECOVERY_UNCONFIRMED', null);
  }

  return {
    controlAction,
    effectObserved,
    businessRecovered,
    resourceCleanup,
    failureClasses: [...failureClasses],
    failureCodes: [...failureCodes].sort(),
  };
}

function classifyFailureEvent(event: FaultRunEventRecord): BaselineFailureClass | null {
  if (CONTROL_FAILURE_EVENTS.has(event.eventType)) return 'CONTROL_PLANE_FAILURE';
  if (WORKER_FAILURE_EVENTS.has(event.eventType)) return 'WORKER_FAILURE';
  if (RECOVERY_FAILURE_EVENTS.has(event.eventType)) return 'RECOVERY_FAILURE';
  if (CLEANUP_FAILURE_EVENTS.has(event.eventType)) return 'CLEANUP_FAILURE';
  if (event.eventType === 'RUNNER_LIFECYCLE_SUMMARY') {
    const payload = asRecord(event.payload);
    if (payload.success === false
        || payload.resultStatus === 'FAILED'
        || payload.status === 'FAILED') return 'TARGET_EFFECT_FAILURE';
  }
  return null;
}

function readFailureCode(event: FaultRunEventRecord): string | null {
  if (classifyFailureEvent(event) === null && !event.eventType.endsWith('_FAILED')) return null;
  const payload = asRecord(event.payload);
  const candidate = payload.errorCode ?? payload.code;
  if (typeof candidate === 'string' && FAILURE_CODE_PATTERN.test(candidate)) return candidate;
  return stableFailureCode(event.eventType);
}

function validateCounters(
  summary: BaselineRequestSummary,
  inFlight: number | null,
  addLimitation: (code: string, detail?: string | null) => void,
): void {
  const { requests, successes, failures, timeouts } = summary;
  if (requests === null || successes === null || failures === null) {
    addLimitation('COUNTER_INCONSISTENT', 'COUNTER_MISSING');
    return;
  }
  const active = inFlight ?? 0;
  if (requests !== successes + failures + active || timeouts !== null && timeouts > failures) {
    addLimitation('COUNTER_INCONSISTENT', null);
  }
  if (summary.p50LatencyMs !== null && summary.p95LatencyMs !== null
      && summary.p50LatencyMs > summary.p95LatencyMs) {
    addLimitation('COUNTER_INCONSISTENT', 'LATENCY_ORDER');
  }
  if (summary.p95LatencyMs !== null && summary.p99LatencyMs !== null
      && summary.p95LatencyMs > summary.p99LatencyMs) {
    addLimitation('COUNTER_INCONSISTENT', 'LATENCY_ORDER');
  }
}

function isScenarioWorkerScenario(scenario: FaultRunScenario): boolean {
  return [
    'BROWSE_SURGE',
    'ORDER_QUERY_SURGE',
    'CATALOG_REDIS_LARGE_VALUE',
    'PROMOTION_LOCK_CONTENTION',
    'INVENTORY_TABLE_EXCLUSIVE',
    'INVENTORY_ROW_LOCK',
  ].includes(scenario);
}

function findFirst(
  events: readonly FaultRunEventRecord[],
  eventType: string,
): FaultRunEventRecord | undefined {
  return events.find((event) => event.eventType === eventType);
}

function findLast(
  events: readonly FaultRunEventRecord[],
  eventType: string,
): FaultRunEventRecord | undefined {
  return [...events].reverse().find((event) => event.eventType === eventType);
}

function timestampFromEvent(event: FaultRunEventRecord | undefined): string | null {
  return event ? validTimestamp(event.createdAt) : null;
}

function firstTimestamp(...values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function counterOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function latencyOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function firstCounter(...values: unknown[]): number | null {
  for (const value of values) {
    const counter = counterOrNull(value);
    if (counter !== null) return counter;
  }
  return null;
}

function firstLatency(...values: unknown[]): number | null {
  for (const value of values) {
    const latency = latencyOrNull(value);
    if (latency !== null) return latency;
  }
  return null;
}

function hasPositiveCounter(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && value > 0;
}

function calculateCaptureStatus(
  limitations: readonly BaselineLimitation[],
): FoldedBaselineFacts['status'] {
  if (limitations.some((limitation) =>
    [
      'MISSING_RUNTIME_EVENT',
      'DISPATCH_UNVERIFIED',
      'COUNTER_INCONSISTENT',
      'MANUAL_CLEANUP_REQUIRED',
    ].includes(limitation.code))) {
    return 'INCOMPLETE';
  }
  return limitations.length > 0 ? 'COMPLETE_WITH_LIMITATIONS' : 'COMPLETE';
}

function stableFailureCode(eventType: string): string | null {
  const codes: Record<string, string> = {
    CREATE_FAILED: 'CONTROL_PLANE_STORAGE_FAILED',
    CREATE_RECOVERY_FAILED: 'RECOVERY_COMPENSATION_FAILED',
    COMPENSATION_FAILED: 'RECOVERY_COMPENSATION_FAILED',
    SCENARIO_WORKER_SETUP_FAILED: 'WORKER_SETUP_FAILED',
    REPORT_WORKER_SETUP_FAILED: 'WORKER_SETUP_FAILED',
    SCENARIO_REQUEST_FAILED: 'WORKER_REQUEST_FAILED',
    REPORT_REQUEST_FAILED: 'WORKER_REQUEST_FAILED',
    RECOVERY_FAILED: 'RECOVERY_RELEASE_FAILED',
    MANUAL_CLEANUP_FAILED: 'CLEANUP_FAILED',
  };
  return codes[eventType] ?? null;
}
