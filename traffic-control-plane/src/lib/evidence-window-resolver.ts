import {
  EVIDENCE_WINDOW_VALUES,
  isEvidenceContractPlan,
  type EvidenceContractPlan,
} from './scenario-contract';
import {
  EvidenceTypeError,
  parseEvidenceSqlTimestamp,
  type EvidenceCoverage,
  type EvidenceLimitation,
  type EvidencePredicateOutcome,
  type EvidenceResolvedWindow,
  type EvidenceTimeline,
  type EvidenceWindowLimits,
} from './evidence-types';

export const EVIDENCE_CLOCK_SKEW_TOLERANCE_SEC = 60;

export type EvidenceWindowResolutionErrorCode =
  | 'EVIDENCE_WINDOW_INVALID_CONTRACT'
  | 'EVIDENCE_WINDOW_INVALID_TIMELINE'
  | 'EVIDENCE_WINDOW_INVALID_LIMITS'
  | 'EVIDENCE_WINDOW_BOUNDARY_ORDER_INVALID'
  | 'EVIDENCE_WINDOW_EXCEEDS_HARD_LIMIT';

export class EvidenceWindowResolutionError extends Error {
  constructor(readonly code: EvidenceWindowResolutionErrorCode) {
    super(code);
    this.name = 'EvidenceWindowResolutionError';
  }
}

export interface EvidenceWindowResolution {
  readonly windows: readonly EvidenceResolvedWindow[];
  readonly limitations: readonly EvidenceLimitation[];
}

export interface EvidenceWindowExecutionPlan {
  readonly canonicalStartAt: string | null;
  readonly canonicalEndAt: string | null;
  readonly executedStartAt: string | null;
  readonly executedEndAt: string | null;
  readonly shouldQuery: boolean;
  readonly windowSettled: boolean;
  readonly coverageHint: EvidenceCoverage | null;
  readonly predicateOutcome: EvidencePredicateOutcome;
  readonly reasonCode: string | null;
}

export function resolveEvidenceWindows(
  evidence: EvidenceContractPlan,
  timeline: EvidenceTimeline,
  limits: EvidenceWindowLimits,
): EvidenceWindowResolution {
  if (!isEvidenceContractPlan(evidence)) {
    throw new EvidenceWindowResolutionError('EVIDENCE_WINDOW_INVALID_CONTRACT');
  }
  if (!isValidTimeline(timeline)) {
    throw new EvidenceWindowResolutionError('EVIDENCE_WINDOW_INVALID_TIMELINE');
  }
  if (!isValidLimits(limits)) {
    throw new EvidenceWindowResolutionError('EVIDENCE_WINDOW_INVALID_LIMITS');
  }

  const policy = evidence.windows;
  const activeAt = optionalTimestamp(timeline.activeAt);
  const recoveryStartedAt = optionalTimestamp(timeline.recoveryStartedAt);
  const recoveredAt = optionalTimestamp(timeline.recoveredAt);
  const cleanupFinishedAt = optionalTimestamp(timeline.cleanupFinishedAt);
  const terminalAt = optionalTimestamp(timeline.terminalAt);
  const cleanupApplicable = evidence.recipes.some((recipe) =>
    recipe.source === 'RUN_EVENT' && recipe.template === 'RUN_TIMELINE'
      && recipe.window === 'cleanup');
  const limitations: EvidenceLimitation[] = [{
    code: `CLOCK_SKEW_TOLERANCE_${EVIDENCE_CLOCK_SKEW_TOLERANCE_SEC}S`,
    window: null,
  }];

  const baseline = activeAt === null
    ? notReadyWindow('baseline', 'ACTIVE_BOUNDARY_MISSING')
    : readyWindow(
      'baseline',
      activeAt - policy.baselineBeforeActiveSec * 1000,
      activeAt,
      limits.baseline,
    );

  let active: EvidenceResolvedWindow;
  if (activeAt === null) {
    active = notReadyWindow('active', 'ACTIVE_BOUNDARY_MISSING');
  } else {
    const activeEnd = recoveryStartedAt ?? terminalAt;
    if (activeEnd === null) {
      active = notReadyWindow('active', 'ACTIVE_END_BOUNDARY_MISSING');
    } else {
      if (recoveryStartedAt === null) {
        limitations.push({ code: 'ACTIVE_END_TERMINAL_FALLBACK', window: 'active' });
      }
      active = readyWindow(
        'active',
        activeAt - policy.activeLeadSec * 1000,
        activeEnd + policy.activeTailSec * 1000,
        limits.active,
      );
    }
  }

  const recovery = recoveryStartedAt === null
    ? notReadyWindow('recovery', 'RECOVERY_BOUNDARY_MISSING')
    : recoveredAt === null
      ? notReadyWindow('recovery', 'RECOVERY_COMPLETION_MISSING')
      : readyWindow(
        'recovery',
        recoveryStartedAt - policy.recoveryLeadSec * 1000,
        recoveredAt + policy.recoveryTailSec * 1000,
        limits.recovery,
      );

  const cleanup = !cleanupApplicable
    ? notApplicableWindow('cleanup', 'CLEANUP_NOT_APPLICABLE')
    : cleanupFinishedAt === null
      ? notReadyWindow('cleanup', 'CLEANUP_COMPLETION_MISSING')
      : readyWindow(
        'cleanup',
        cleanupFinishedAt - policy.cleanupLeadSec * 1000,
        cleanupFinishedAt,
        limits.cleanup,
      );

  return {
    windows: [baseline, active, recovery, cleanup],
    limitations,
  };
}

export function resolveEvidenceWindowExecution(
  window: EvidenceResolvedWindow,
  databaseNow: string,
): EvidenceWindowExecutionPlan {
  const now = timestampMilliseconds(databaseNow);
  if (window.state !== 'READY'
    || window.canonicalStartAt === null || window.canonicalEndAt === null) {
    return {
      canonicalStartAt: null,
      canonicalEndAt: null,
      executedStartAt: null,
      executedEndAt: null,
      shouldQuery: false,
      windowSettled: false,
      coverageHint: 'NONE',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCode: window.reasonCode ?? 'WINDOW_NOT_READY',
    };
  }

  const start = timestampMilliseconds(window.canonicalStartAt);
  const end = timestampMilliseconds(window.canonicalEndAt);
  if (end < start) {
    throw new EvidenceWindowResolutionError('EVIDENCE_WINDOW_BOUNDARY_ORDER_INVALID');
  }
  if (end === start) {
    return {
      canonicalStartAt: window.canonicalStartAt,
      canonicalEndAt: window.canonicalEndAt,
      executedStartAt: null,
      executedEndAt: null,
      shouldQuery: false,
      windowSettled: now >= end,
      coverageHint: 'NONE',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCode: 'ZERO_LENGTH_WINDOW',
    };
  }

  const executedEnd = Math.min(end, now);
  if (executedEnd <= start) {
    return {
      canonicalStartAt: window.canonicalStartAt,
      canonicalEndAt: window.canonicalEndAt,
      executedStartAt: null,
      executedEndAt: null,
      shouldQuery: false,
      windowSettled: false,
      coverageHint: 'NONE',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCode: 'WINDOW_NOT_SETTLED',
    };
  }

  const windowSettled = now >= end;
  return {
    canonicalStartAt: window.canonicalStartAt,
    canonicalEndAt: window.canonicalEndAt,
    executedStartAt: window.canonicalStartAt,
    executedEndAt: new Date(executedEnd).toISOString(),
    shouldQuery: true,
    windowSettled,
    coverageHint: windowSettled ? null : 'PARTIAL',
    predicateOutcome: 'INCONCLUSIVE',
    reasonCode: windowSettled ? null : 'WINDOW_NOT_SETTLED',
  };
}

function readyWindow(
  name: EvidenceResolvedWindow['name'],
  startMs: number,
  endMs: number,
  hardLimitSec: number,
): EvidenceResolvedWindow {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs < startMs) {
    throw new EvidenceWindowResolutionError('EVIDENCE_WINDOW_BOUNDARY_ORDER_INVALID');
  }
  if (!Number.isFinite(new Date(startMs).getTime()) || !Number.isFinite(new Date(endMs).getTime())) {
    throw new EvidenceWindowResolutionError('EVIDENCE_WINDOW_BOUNDARY_ORDER_INVALID');
  }
  if ((endMs - startMs) / 1000 > hardLimitSec) {
    throw new EvidenceWindowResolutionError('EVIDENCE_WINDOW_EXCEEDS_HARD_LIMIT');
  }
  return {
    name,
    state: 'READY',
    canonicalStartAt: new Date(startMs).toISOString(),
    canonicalEndAt: new Date(endMs).toISOString(),
    reasonCode: null,
  };
}

function notReadyWindow(
  name: EvidenceResolvedWindow['name'],
  reasonCode: string,
): EvidenceResolvedWindow {
  return {
    name,
    state: 'NOT_READY',
    canonicalStartAt: null,
    canonicalEndAt: null,
    reasonCode,
  };
}

function notApplicableWindow(
  name: EvidenceResolvedWindow['name'],
  reasonCode: string,
): EvidenceResolvedWindow {
  return {
    name,
    state: 'NOT_APPLICABLE',
    canonicalStartAt: null,
    canonicalEndAt: null,
    reasonCode,
  };
}

function optionalTimestamp(value: string | null): number | null {
  return value === null ? null : timestampMilliseconds(value);
}

function timestampMilliseconds(value: string): number {
  try {
    return Date.parse(parseEvidenceSqlTimestamp(value));
  } catch (error) {
    if (error instanceof EvidenceTypeError) {
      throw new EvidenceWindowResolutionError('EVIDENCE_WINDOW_INVALID_TIMELINE');
    }
    throw error;
  }
}

function isValidTimeline(value: EvidenceTimeline): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== [
    'activeAt',
    'cleanupFinishedAt',
    'createdAt',
    'prepareStartedAt',
    'recoveredAt',
    'recoveryStartedAt',
    'stopRequestedAt',
    'terminalAt',
    'terminalState',
  ].sort().join(',')) return false;
  if (value.terminalState !== null
    && !['RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].includes(value.terminalState)) return false;
  return [
    value.createdAt,
    value.prepareStartedAt,
    value.activeAt,
    value.stopRequestedAt,
    value.recoveryStartedAt,
    value.recoveredAt,
    value.cleanupFinishedAt,
    value.terminalAt,
  ].every((time) => {
    if (time === null) return true;
    try {
      parseEvidenceSqlTimestamp(time);
      return true;
    } catch (error) {
      if (error instanceof EvidenceTypeError) return false;
      throw error;
    }
  });
}

function isValidLimits(value: EvidenceWindowLimits): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== [...EVIDENCE_WINDOW_VALUES].sort().join(',')) return false;
  return EVIDENCE_WINDOW_VALUES.every((window) =>
    Number.isSafeInteger(value[window]) && value[window] >= 1 && value[window] <= 86_400);
}
