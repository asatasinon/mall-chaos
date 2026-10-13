import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FaultRunActionRecord } from './fault-run-action-repository';
import type { FaultRunEventRecord, FaultRunRecord } from './fault-run-repository';
import {
  createInitialFaultRunRecoveryProjection,
  type FaultRunRecoveryProjection,
} from './fault-run-recovery';
import { projectEvidenceTimeline, EvidenceTimelineProjectionError } from './evidence-timeline';

const RUN_ID = '123e4567-e89b-12d3-a456-426614174000';
const PREPARE_ACTION_ID = '223e4567-e89b-12d3-a456-426614174001';

test('projects sorted UTC anchors from first stop attempt and matching recovery attempt', () => {
  const run = createRun({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    state: 'STOPPED',
    startedAt: '2026-10-09T06:01:00.000Z',
    stoppedAt: '2026-10-09T06:07:01.000Z',
    recoveryResult: successfulProjection(2),
  });
  const events = [
    event(6, 'STOP_REQUESTED', '2026-10-09T06:02:00.000Z', { attempt: 2 }),
    event(8, 'RECOVERY_COMPLETED', '2026-10-09T06:07:00.000Z', { attempt: 2 }),
    event(5, 'DRAIN_STARTED', '2026-10-09T06:06:00.000Z', { attempt: 2, privatePayload: 'discard' }),
    event(2, 'TARGET_CONFIRMED', '2026-10-09T06:01:01.000Z'),
    event(1, 'CREATED', '2026-10-09T06:00:00.000Z'),
    event(3, 'STOP_REQUESTED', '2026-10-09T06:02:00.000Z', { attempt: 1 }),
    event(4, 'DRAIN_STARTED', '2026-10-09T06:03:00.000Z', { attempt: 1 }),
    event(7, 'MANUAL_CLEANUP_COMPLETED', '2026-10-09T06:06:30.000Z', {
      attempt: 2,
      cleanupAttempt: 1,
      rawResult: 'must-not-escape',
    }),
  ];
  const actions = [
    action('RELEASE', null, '2026-10-09T06:02:01.000Z'),
    action('PREPARE', '2026-10-09T06:00:30.000Z', '2026-10-09T06:00:29.000Z'),
    action('PREPARE', '2026-10-09T06:00:31.000Z', '2026-10-09T06:00:31.000Z'),
  ];

  const timeline = projectEvidenceTimeline(run, events, actions);
  assert.deepEqual(timeline, {
    createdAt: '2026-10-09T06:00:00.000Z',
    prepareStartedAt: '2026-10-09T06:00:30.000Z',
    activeAt: '2026-10-09T06:01:00.000Z',
    stopRequestedAt: '2026-10-09T06:02:00.000Z',
    recoveryStartedAt: '2026-10-09T06:03:00.000Z',
    recoveredAt: '2026-10-09T06:07:00.000Z',
    cleanupFinishedAt: '2026-10-09T06:06:30.000Z',
    terminalAt: '2026-10-09T06:07:01.000Z',
    terminalState: 'STOPPED',
  });
  assert.equal(JSON.stringify(timeline).includes('must-not-escape'), false);
});

test('missing and unsuccessful lifecycle anchors remain null instead of being inferred', () => {
  const run = createRun({
    state: 'RECOVERING',
    startedAt: null,
    stoppedAt: null,
    recoveryResult: verifyUnavailableProjection(),
  });
  const timeline = projectEvidenceTimeline(run, [
    event(2, 'DRAIN_STARTED', '2026-10-09T06:01:00.000Z', { attempt: 1 }),
    event(1, 'RECOVERY_COMPLETED', '2026-10-09T06:02:00.000Z', { attempt: 1 }),
  ], [action('PREPARE', null, '2026-10-09T06:00:01.000Z')]);

  assert.equal(timeline.activeAt, null);
  assert.equal(timeline.stopRequestedAt, null);
  assert.equal(timeline.recoveryStartedAt, null);
  assert.equal(timeline.recoveredAt, null);
  assert.equal(timeline.terminalAt, null);
  assert.equal(timeline.terminalState, null);
  assert.equal(timeline.cleanupFinishedAt, null);

  const safeRuntimeWithLegacyNamedEvent = projectEvidenceTimeline(
    createRun({
      state: 'RECOVERING',
      recoveryResult: verifyUnavailableProjection(),
    }),
    [event(9, 'SERVICE_RECOVERED', '2026-10-09T06:02:00.000Z')],
    [],
  );
  assert.equal(safeRuntimeWithLegacyNamedEvent.recoveredAt, null);
});

test('legacy recovery uses explicit legacy anchors without manufacturing safe-runtime facts', () => {
  const run = createRun({
    state: 'RECOVERED',
    stoppedAt: '2026-10-09T06:02:02.000Z',
    recoveryResult: { stopped: true },
  });
  const timeline = projectEvidenceTimeline(run, [
    event(3, 'SERVICE_RECOVERED', '2026-10-09T06:02:00.000Z'),
    event(2, 'RECOVERY_STARTED', '2026-10-09T06:01:00.000Z'),
    event(1, 'CREATED', '2026-10-09T06:00:00.000Z'),
  ], []);

  assert.equal(timeline.recoveryStartedAt, '2026-10-09T06:01:00.000Z');
  assert.equal(timeline.recoveredAt, '2026-10-09T06:02:00.000Z');
  assert.equal(timeline.terminalAt, '2026-10-09T06:02:02.000Z');
  assert.equal(timeline.terminalState, 'RECOVERED');
  assert.equal(timeline.prepareStartedAt, null);
});

test('terminalAt needs both the persisted stopped time and a matching terminal event', () => {
  const run = createRun({ state: 'FAILED', stoppedAt: '2026-10-09T06:02:00.000Z' });
  const timeline = projectEvidenceTimeline(run, [
    event(1, 'CREATED', '2026-10-09T06:00:00.000Z'),
  ], []);
  assert.equal(timeline.terminalState, 'FAILED');
  assert.equal(timeline.terminalAt, null);
});

test('rejects cross-run and malformed timestamp facts', () => {
  const run = createRun();
  assert.throws(
    () => projectEvidenceTimeline(run, [
      { ...event(1, 'CREATED', '2026-10-09T06:00:00.000Z'), faultRunId: 'different-run' },
    ], []),
    (error: unknown) => error instanceof EvidenceTimelineProjectionError
      && error.code === 'EVIDENCE_TIMELINE_EVENT_INVALID',
  );
  assert.throws(
    () => projectEvidenceTimeline(run, [
      event(1, 'CREATED', 'not-a-date'),
    ], []),
    (error: unknown) => error instanceof EvidenceTimelineProjectionError
      && error.code === 'EVIDENCE_TIMELINE_TIMESTAMP_INVALID',
  );
});

function createRun(overrides: Partial<FaultRunRecord> = {}): FaultRunRecord {
  return {
    faultRunId: RUN_ID,
    scenario: 'BROWSE_REPORT_SQL',
    targetService: 'catalog-service',
    targetOperation: 'products-browse-report',
    state: 'CREATING',
    parameters: { durationSec: 60 },
    contractRevision: 'sc.v1:sha256:' + 'a'.repeat(64),
    idempotencyKey: 'timeline-run-key-001',
    fencingToken: 1,
    startedAt: null,
    expiresAt: '2026-10-09T06:10:00.000Z',
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-timeline',
    createdAt: '2026-10-09 06:00:00.000',
    updatedAt: '2026-10-09 06:00:00.000',
    ...overrides,
  };
}

function event(
  id: number,
  eventType: string,
  createdAt: string,
  payload: unknown = {},
): FaultRunEventRecord {
  return { id, faultRunId: RUN_ID, eventType, createdAt, payload };
}

function action(
  actionType: FaultRunActionRecord['actionType'],
  dispatchStartedAt: string | null,
  requestedAt: string,
): FaultRunActionRecord {
  return {
    actionId: actionType === 'PREPARE' ? PREPARE_ACTION_ID : '323e4567-e89b-12d3-a456-426614174005',
    faultRunId: RUN_ID,
    actionType,
    attemptNo: 1,
    actionState: dispatchStartedAt === null ? 'REQUESTED' : 'DISPATCHING',
    requestedBy: 'RECONCILER',
    requestIdempotencyKey: 'timeline-action-key-001',
    operatorAuditId: null,
    dispatchOwnerId: null,
    dispatchOwnerEpoch: null,
    requestedAt,
    dispatchStartedAt,
    completedAt: null,
    resultSummary: null,
    errorCode: null,
    createdAt: requestedAt,
    updatedAt: requestedAt,
  };
}

function successfulProjection(attempt: number): FaultRunRecoveryProjection {
  const initial = createInitialFaultRunRecoveryProjection({
    reason: 'MANUAL',
    requestedAt: '2026-10-09T06:05:00.000Z',
    drainDeadlineAt: '2026-10-09T06:06:00.000Z',
    recoveryDeadlineAt: '2026-10-09T06:07:00.000Z',
    attempt,
  });
  return {
    ...initial,
    phase: 'COMPLETED',
    outcome: 'SUCCEEDED',
    drain: {
      status: 'SUCCEEDED',
      attempt,
      startedAt: '2026-10-09T06:06:00.000Z',
      completedAt: '2026-10-09T06:06:10.000Z',
    },
    release: {
      status: 'SUCCEEDED',
      attempt,
      startedAt: '2026-10-09T06:06:10.000Z',
      completedAt: '2026-10-09T06:06:20.000Z',
    },
    cleanup: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: '2026-10-09T06:06:20.000Z',
      completedAt: '2026-10-09T06:06:30.000Z',
    },
    verification: {
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: '2026-10-09T06:06:30.000Z',
      completedAt: '2026-10-09T06:07:00.000Z',
    },
    residuals: [],
  };
}

function verifyUnavailableProjection(): FaultRunRecoveryProjection {
  const completed = successfulProjection(1);
  return {
    ...completed,
    phase: 'PARTIAL_RECOVERY',
    outcome: 'VERIFY_UNAVAILABLE',
    verification: {
      status: 'NOT_CONFIGURED',
      attempt: 1,
      startedAt: '2026-10-09T06:01:10.000Z',
      completedAt: '2026-10-09T06:01:10.000Z',
      errorCode: 'VERIFY_UNAVAILABLE',
    },
    residuals: [{
      kind: 'VERIFICATION_UNAVAILABLE',
      responsibility: 'CONTROL_PLANE',
      nextAction: 'CONFIGURE_VERIFICATION',
    }],
    lastError: {
      stage: 'VERIFY',
      code: 'VERIFY_UNAVAILABLE',
      retryable: false,
    },
  };
}
