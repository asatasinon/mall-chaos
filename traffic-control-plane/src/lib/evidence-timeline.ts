import type {
  FaultRunEventRecord,
  FaultRunRecord,
} from './fault-run-repository';
import {
  EvidenceTypeError,
  parseEvidenceSqlTimestamp,
  type EvidenceTimeline,
} from './evidence-types';
import { parseFaultRunRecoveryProjection } from './fault-run-recovery';

export type EvidenceTimelineProjectionErrorCode =
  | 'EVIDENCE_TIMELINE_RUN_MISMATCH'
  | 'EVIDENCE_TIMELINE_EVENT_INVALID'
  | 'EVIDENCE_TIMELINE_ACTION_INVALID'
  | 'EVIDENCE_TIMELINE_TIMESTAMP_INVALID';

export class EvidenceTimelineProjectionError extends Error {
  constructor(readonly code: EvidenceTimelineProjectionErrorCode) {
    super(code);
    this.name = 'EvidenceTimelineProjectionError';
  }
}

type TerminalState = EvidenceTimeline['terminalState'];

interface OrderedEvent {
  readonly event: FaultRunEventRecord;
  readonly timestamp: string;
}

interface OrderedPrepareAction {
  readonly action: EvidenceTimelineActionFact;
  readonly dispatchStartedAt: string;
}

export interface EvidenceTimelineActionFact {
  readonly actionId: string;
  readonly faultRunId: string;
  readonly actionType: string;
  readonly dispatchStartedAt: string | null;
}

export function projectEvidenceTimeline(
  run: Pick<
    FaultRunRecord,
    'faultRunId' | 'createdAt' | 'startedAt' | 'stoppedAt' | 'state' | 'recoveryResult'
  >,
  events: readonly FaultRunEventRecord[],
  actions: readonly EvidenceTimelineActionFact[],
): EvidenceTimeline {
  const createdAt = timestamp(run.createdAt);
  const orderedEvents = orderEvents(run.faultRunId, events);
  const prepareActions = orderPrepareActions(run.faultRunId, actions);
  const recoveryRead = parseFaultRunRecoveryProjection(run.recoveryResult);
  const currentAttempt = recoveryRead.kind === 'SAFE_RUNTIME_V1'
    ? recoveryRead.projection.stop.attempt
    : null;

  const stopEvent = firstEvent(orderedEvents, 'STOP_REQUESTED');
  const initialStopAttempt = stopEvent ? eventAttempt(stopEvent.event) : null;
  const recoveryStartedEvent = recoveryRead.kind === 'SAFE_RUNTIME_V1'
    ? initialStopAttempt === null
      ? null
      : firstEvent(orderedEvents, 'DRAIN_STARTED', (event) => eventAttempt(event) === initialStopAttempt)
    : recoveryRead.kind === 'LEGACY'
      ? firstEvent(orderedEvents, 'RECOVERY_STARTED')
      : null;
  const recoveryCompletedEvent = findRecoveryCompletedEvent(
    run,
    recoveryRead,
    orderedEvents,
  );
  const recoveredAt = recoveryCompletedEvent?.timestamp
    ?? (recoveryRead.kind === 'SAFE_RUNTIME_V1'
      ? null
      : firstEvent(orderedEvents, 'SERVICE_RECOVERED')?.timestamp ?? null);
  const cleanupEvent = firstEvent(orderedEvents, 'MANUAL_CLEANUP_COMPLETED', (event) => (
    recoveryRead.kind !== 'SAFE_RUNTIME_V1'
      || (eventAttempt(event) === currentAttempt
        && eventCleanupAttempt(event) === recoveryRead.projection.cleanup.attempt)
  ));
  const terminalState = toTerminalState(run.state);
  const terminalEvent = terminalState === null
    ? null
    : findTerminalEvent(terminalState, recoveryCompletedEvent, orderedEvents);
  const terminalAt = terminalEvent && run.stoppedAt !== null
    ? timestamp(run.stoppedAt)
    : null;
  const activeEvent = firstEvent(orderedEvents, 'TARGET_CONFIRMED');

  return {
    createdAt,
    prepareStartedAt: prepareActions[0]?.dispatchStartedAt ?? null,
    activeAt: activeEvent && run.startedAt !== null ? timestamp(run.startedAt) : null,
    stopRequestedAt: stopEvent?.timestamp ?? null,
    recoveryStartedAt: recoveryStartedEvent?.timestamp ?? null,
    recoveredAt,
    cleanupFinishedAt: cleanupEvent?.timestamp ?? null,
    terminalAt,
    terminalState,
  };
}

function orderEvents(
  sourceFaultRunId: string,
  events: readonly FaultRunEventRecord[],
): OrderedEvent[] {
  return events.map((event) => {
    if (event.faultRunId !== sourceFaultRunId
      || !Number.isSafeInteger(event.id) || event.id < 1
      || typeof event.eventType !== 'string') {
      throw new EvidenceTimelineProjectionError('EVIDENCE_TIMELINE_EVENT_INVALID');
    }
    return { event, timestamp: timestamp(event.createdAt) };
  }).sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp) || left.event.id - right.event.id);
}

function orderPrepareActions(
  sourceFaultRunId: string,
  actions: readonly EvidenceTimelineActionFact[],
): OrderedPrepareAction[] {
  return actions.flatMap((action) => {
    if (action.faultRunId !== sourceFaultRunId) {
      throw new EvidenceTimelineProjectionError('EVIDENCE_TIMELINE_RUN_MISMATCH');
    }
    if (action.actionType !== 'PREPARE' || action.dispatchStartedAt === null) return [];
    return [{ action, dispatchStartedAt: timestamp(action.dispatchStartedAt) }];
  }).sort((left, right) =>
    left.dispatchStartedAt.localeCompare(right.dispatchStartedAt)
    || left.action.actionId.localeCompare(right.action.actionId));
}

function firstEvent(
  events: readonly OrderedEvent[],
  eventType: string,
  predicate: (event: FaultRunEventRecord) => boolean = () => true,
): OrderedEvent | null {
  return events.find(({ event }) => event.eventType === eventType && predicate(event)) ?? null;
}

function findRecoveryCompletedEvent(
  run: Pick<FaultRunRecord, 'state' | 'recoveryResult'>,
  recoveryRead: ReturnType<typeof parseFaultRunRecoveryProjection>,
  events: readonly OrderedEvent[],
): OrderedEvent | null {
  if (recoveryRead.kind === 'SAFE_RUNTIME_V1') {
    const projection = recoveryRead.projection;
    if (projection.phase !== 'COMPLETED' || projection.outcome !== 'SUCCEEDED'
      || (run.state !== 'RECOVERED' && run.state !== 'STOPPED')) return null;
    return firstEvent(events, 'RECOVERY_COMPLETED', (event) =>
      eventAttempt(event) === projection.stop.attempt);
  }
  if (recoveryRead.kind === 'LEGACY'
    && (run.state === 'RECOVERED' || run.state === 'STOPPED')
    && asRecord(run.recoveryResult)?.stopped === true) {
    return firstEvent(events, 'RECOVERY_COMPLETED');
  }
  return null;
}

function findTerminalEvent(
  state: Exclude<TerminalState, null>,
  recoveryCompleted: OrderedEvent | null,
  events: readonly OrderedEvent[],
): OrderedEvent | null {
  if (state === 'RECOVERED' || state === 'STOPPED') {
    return recoveryCompleted ?? firstEvent(events, 'SERVICE_RECOVERED');
  }
  if (state === 'SERVICE_UNAVAILABLE') return firstEvent(events, 'SERVICE_UNAVAILABLE');
  return firstEvent(events, 'CREATE_FAILED')
    ?? firstEvent(events, 'CREATE_RECOVERY_FAILED')
    ?? firstEvent(events, 'RECOVERY_FAILED');
}

function toTerminalState(state: FaultRunRecord['state']): TerminalState {
  return state === 'RECOVERED' || state === 'STOPPED' || state === 'FAILED'
    || state === 'SERVICE_UNAVAILABLE'
    ? state
    : null;
}

function eventAttempt(event: FaultRunEventRecord): number | null {
  const attempt = asRecord(event.payload)?.attempt;
  return Number.isSafeInteger(attempt) && typeof attempt === 'number' && attempt > 0
    ? attempt
    : null;
}

function eventCleanupAttempt(event: FaultRunEventRecord): number | null {
  const attempt = asRecord(event.payload)?.cleanupAttempt;
  return Number.isSafeInteger(attempt) && typeof attempt === 'number' && attempt > 0
    ? attempt
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null;
}

function timestamp(value: unknown): string {
  try {
    return parseEvidenceSqlTimestamp(value);
  } catch (error) {
    if (error instanceof EvidenceTypeError) {
      throw new EvidenceTimelineProjectionError('EVIDENCE_TIMELINE_TIMESTAMP_INVALID');
    }
    throw error;
  }
}
