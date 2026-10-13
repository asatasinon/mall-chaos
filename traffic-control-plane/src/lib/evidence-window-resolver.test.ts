import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getScenarioDefinition, listScenarioDefinitions } from './fault-run-catalog';
import {
  resolveScenarioContract,
} from './scenario-contract';
import type { EvidenceTimeline, EvidenceWindowLimits } from './evidence-types';
import {
  EvidenceWindowResolutionError,
  resolveEvidenceWindowExecution,
  resolveEvidenceWindows,
} from './evidence-window-resolver';

const LIMITS: EvidenceWindowLimits = {
  baseline: 900,
  active: 3660,
  recovery: 2100,
  cleanup: 600,
};

test('resolves all four canonical windows from the frozen policy and timeline', () => {
  const contract = resolveScenarioContract(getScenarioDefinition('NOTIFICATION_STORAGE_APPEND'));
  const timeline = createTimeline({
    activeAt: '2026-10-09T05:10:00.000Z',
    stopRequestedAt: '2026-10-09T05:39:59.000Z',
    recoveryStartedAt: '2026-10-09T05:40:00.000Z',
    recoveredAt: '2026-10-09T06:00:00.000Z',
    cleanupFinishedAt: '2026-10-09T06:03:00.000Z',
    terminalAt: '2026-10-09T06:00:00.000Z',
    terminalState: 'STOPPED',
  });

  const result = resolveEvidenceWindows(contract.evidence, timeline, LIMITS);
  assert.deepEqual(result.windows, [
    {
      name: 'baseline',
      state: 'READY',
      canonicalStartAt: '2026-10-09T05:05:00.000Z',
      canonicalEndAt: '2026-10-09T05:10:00.000Z',
      reasonCode: null,
    },
    {
      name: 'active',
      state: 'READY',
      canonicalStartAt: '2026-10-09T05:09:30.000Z',
      canonicalEndAt: '2026-10-09T05:40:30.000Z',
      reasonCode: null,
    },
    {
      name: 'recovery',
      state: 'READY',
      canonicalStartAt: '2026-10-09T05:39:30.000Z',
      canonicalEndAt: '2026-10-09T06:05:00.000Z',
      reasonCode: null,
    },
    {
      name: 'cleanup',
      state: 'READY',
      canonicalStartAt: '2026-10-09T05:58:00.000Z',
      canonicalEndAt: '2026-10-09T06:03:00.000Z',
      reasonCode: null,
    },
  ]);
  assert.deepEqual(result.limitations, [{ code: 'CLOCK_SKEW_TOLERANCE_60S', window: null }]);
});

test('resolves every Catalog scenario within its capture-time hard limits', () => {
  const activeAt = Date.parse('2026-10-09T05:00:00.000Z');
  for (const definition of listScenarioDefinitions()) {
    const contract = resolveScenarioContract(definition);
    const recoveryStartedAt = new Date(activeAt + definition.maxDurationSec * 1000).toISOString();
    const recoveredAt = new Date(Date.parse(recoveryStartedAt) + 1000).toISOString();
    const cleanupApplicable = contract.lifecycle.cleanupActionTypes.length > 0;
    const timeline = createTimeline({
      activeAt: new Date(activeAt).toISOString(),
      recoveryStartedAt,
      recoveredAt,
      cleanupFinishedAt: cleanupApplicable
        ? new Date(Date.parse(recoveredAt) + 60_000).toISOString()
        : null,
      terminalAt: recoveredAt,
      terminalState: 'STOPPED',
    });
    const result = resolveEvidenceWindows(contract.evidence, timeline, {
      baseline: 900,
      active: definition.maxDurationSec + 60,
      recovery: 2100,
      cleanup: 600,
    });

    assert.equal(result.windows.find(({ name }) => name === 'active')?.state, 'READY', definition.scenario);
    assert.equal(
      result.windows.find(({ name }) => name === 'cleanup')?.state,
      cleanupApplicable ? 'READY' : 'NOT_APPLICABLE',
      definition.scenario,
    );
  }
});

test('uses a marked terminal fallback for active and preserves missing recovery as NOT_READY', () => {
  const contract = resolveScenarioContract(getScenarioDefinition('BROWSE_REPORT_SQL'));
  const result = resolveEvidenceWindows(contract.evidence, createTimeline({
    activeAt: '2026-10-09T05:10:00.000Z',
    terminalAt: '2026-10-09T05:20:00.000Z',
    terminalState: 'FAILED',
  }), LIMITS);

  assert.deepEqual(result.windows.find(({ name }) => name === 'active'), {
    name: 'active',
    state: 'READY',
    canonicalStartAt: '2026-10-09T05:09:30.000Z',
    canonicalEndAt: '2026-10-09T05:20:30.000Z',
    reasonCode: null,
  });
  assert.deepEqual(result.windows.find(({ name }) => name === 'recovery'), {
    name: 'recovery',
    state: 'NOT_READY',
    canonicalStartAt: null,
    canonicalEndAt: null,
    reasonCode: 'RECOVERY_BOUNDARY_MISSING',
  });
  assert.deepEqual(result.limitations, [
    { code: 'CLOCK_SKEW_TOLERANCE_60S', window: null },
    { code: 'ACTIVE_END_TERMINAL_FALLBACK', window: 'active' },
  ]);
});

test('distinguishes cleanup NOT_APPLICABLE from applicable-but-missing', () => {
  const noCleanup = resolveScenarioContract(getScenarioDefinition('BROWSE_REPORT_SQL'));
  const cleanupApplicable = resolveScenarioContract(getScenarioDefinition('NOTIFICATION_STORAGE_APPEND'));
  const timeline = createTimeline();

  assert.deepEqual(
    resolveEvidenceWindows(noCleanup.evidence, timeline, LIMITS).windows.find(({ name }) => name === 'cleanup'),
    {
      name: 'cleanup',
      state: 'NOT_APPLICABLE',
      canonicalStartAt: null,
      canonicalEndAt: null,
      reasonCode: 'CLEANUP_NOT_APPLICABLE',
    },
  );
  assert.deepEqual(
    resolveEvidenceWindows(cleanupApplicable.evidence, timeline, LIMITS).windows.find(({ name }) => name === 'cleanup'),
    {
      name: 'cleanup',
      state: 'NOT_READY',
      canonicalStartAt: null,
      canonicalEndAt: null,
      reasonCode: 'CLEANUP_COMPLETION_MISSING',
    },
  );
});

test('rejects windows that exceed frozen hard limits and never shifts canonical boundaries', () => {
  const contract = resolveScenarioContract(getScenarioDefinition('BROWSE_REPORT_SQL'));
  const timeline = createTimeline({ activeAt: '2026-10-09T05:10:00.000Z' });
  assert.throws(
    () => resolveEvidenceWindows(contract.evidence, timeline, { ...LIMITS, baseline: 120 }),
    (error: unknown) => error instanceof EvidenceWindowResolutionError
      && error.code === 'EVIDENCE_WINDOW_EXCEEDS_HARD_LIMIT',
  );

  const skewed = createTimeline({
    activeAt: '2026-10-09T05:10:00.000Z',
    recoveryStartedAt: '2026-10-09T05:08:59.999Z',
  });
  assert.throws(
    () => resolveEvidenceWindows(contract.evidence, skewed, LIMITS),
    (error: unknown) => error instanceof EvidenceWindowResolutionError
      && error.code === 'EVIDENCE_WINDOW_BOUNDARY_ORDER_INVALID',
  );
});

test('retains a zero-length canonical window without moving or extending it', () => {
  const contract = resolveScenarioContract(getScenarioDefinition('BROWSE_REPORT_SQL'));
  const result = resolveEvidenceWindows(contract.evidence, createTimeline({
    activeAt: '2026-10-09T05:10:00.000Z',
    recoveryStartedAt: '2026-10-09T05:09:00.000Z',
  }), LIMITS);
  const active = result.windows.find(({ name }) => name === 'active');
  assert.deepEqual(active, {
    name: 'active',
    state: 'READY',
    canonicalStartAt: '2026-10-09T05:09:30.000Z',
    canonicalEndAt: '2026-10-09T05:09:30.000Z',
    reasonCode: null,
  });
});

test('future tails query only the arrived positive range and keep canonical boundaries fixed', () => {
  const window = {
    name: 'active' as const,
    state: 'READY' as const,
    canonicalStartAt: '2026-10-09T05:00:00.000Z',
    canonicalEndAt: '2026-10-09T05:05:00.000Z',
    reasonCode: null,
  };
  const partial = resolveEvidenceWindowExecution(window, '2026-10-09T05:03:00.000Z');
  assert.deepEqual(partial, {
    canonicalStartAt: window.canonicalStartAt,
    canonicalEndAt: window.canonicalEndAt,
    executedStartAt: window.canonicalStartAt,
    executedEndAt: '2026-10-09T05:03:00.000Z',
    shouldQuery: true,
    windowSettled: false,
    coverageHint: 'PARTIAL',
    predicateOutcome: 'INCONCLUSIVE',
    reasonCode: 'WINDOW_NOT_SETTLED',
  });

  const notYetStarted = resolveEvidenceWindowExecution(window, '2026-10-09T04:59:00.000Z');
  assert.equal(notYetStarted.shouldQuery, false);
  assert.equal(notYetStarted.executedStartAt, null);
  assert.equal(notYetStarted.coverageHint, 'NONE');
  assert.equal(notYetStarted.predicateOutcome, 'INCONCLUSIVE');

  const settled = resolveEvidenceWindowExecution(window, '2026-10-09T05:06:00.000Z');
  assert.equal(settled.windowSettled, true);
  assert.equal(settled.executedEndAt, window.canonicalEndAt);
  assert.equal(settled.canonicalEndAt, window.canonicalEndAt);
  assert.equal(settled.coverageHint, null);
});

test('does not query zero-length or not-ready windows', () => {
  const zeroLength = resolveEvidenceWindowExecution({
    name: 'active',
    state: 'READY',
    canonicalStartAt: '2026-10-09T05:00:00.000Z',
    canonicalEndAt: '2026-10-09T05:00:00.000Z',
    reasonCode: null,
  }, '2026-10-09T05:01:00.000Z');
  assert.equal(zeroLength.shouldQuery, false);
  assert.equal(zeroLength.reasonCode, 'ZERO_LENGTH_WINDOW');

  const notReady = resolveEvidenceWindowExecution({
    name: 'recovery',
    state: 'NOT_READY',
    canonicalStartAt: null,
    canonicalEndAt: null,
    reasonCode: 'RECOVERY_BOUNDARY_MISSING',
  }, '2026-10-09T05:01:00.000Z');
  assert.equal(notReady.shouldQuery, false);
  assert.equal(notReady.reasonCode, 'RECOVERY_BOUNDARY_MISSING');
});

function createTimeline(overrides: Partial<EvidenceTimeline> = {}): EvidenceTimeline {
  return {
    createdAt: '2026-10-09T05:00:00.000Z',
    prepareStartedAt: null,
    activeAt: null,
    stopRequestedAt: null,
    recoveryStartedAt: null,
    recoveredAt: null,
    cleanupFinishedAt: null,
    terminalAt: null,
    terminalState: null,
    ...overrides,
  };
}
