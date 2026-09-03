import type {
  Event,
  FaultRunCleanupResult,
  FaultRunDetails,
  FaultRunDrain,
  FaultRunTargetSummary,
  FaultRunWorkerStats,
} from './types';

const CACHE_RESULT_KEYS = [
  'CACHE_HIT',
  'CACHE_MISS_DB_FALLBACK',
  'CACHE_INVALID_FALLBACK',
  'CACHE_BACKEND_ERROR',
  'CACHE_UNKNOWN',
] as const;

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type FaultRunTranslator = (key: string, values?: Record<string, string | number>) => string;

export type FaultRunViewModel = {
  targetSummary: FaultRunTargetSummary | null;
  workerStats: FaultRunWorkerStats | null;
  drain: FaultRunDrain | null;
  cleanup: FaultRunCleanupResult | null;
  markerState: 'PUBLISHED' | 'RELEASED' | 'UNKNOWN';
};

export function buildFaultRunView(details: FaultRunDetails): FaultRunViewModel {
  const targetSummary = findTargetSummary(details.events, details.run.faultRunId);
  const workerEvent = [...details.events].reverse().find((event) =>
    event.eventType === 'SCENARIO_WORKER_DRAINED' || event.eventType === 'SCENARIO_WORKER_STOPPED');
  const workerStats = workerEvent ? readWorkerStats(workerEvent.payload) : null;
  const recoveryEvent = [...details.events].reverse().find((event) => event.eventType === 'RECOVERY_COMPLETED');
  const recoveryPayload = recoveryEvent ? asRecord(recoveryEvent.payload) : null;
  const drain = readDrain(recoveryPayload?.workerDrain);
  const cleanup = readCleanup(
    recoveryPayload?.result,
    recoveryPayload,
    details.events.find((event) => event.eventType === 'MANUAL_CLEANUP_COMPLETED')?.payload,
    details.run.recoveryResult,
  );

  return {
    targetSummary,
    workerStats,
    drain,
    cleanup,
    markerState: cleanup?.released || cleanup?.markerRemoved
      ? 'RELEASED'
      : targetSummary && ['ACTIVE', 'RECOVERING'].includes(details.run.state)
        ? 'PUBLISHED'
        : 'UNKNOWN',
  };
}

export function summarizeFaultRunEvent(event: Event, translate: FaultRunTranslator = defaultTranslate): string {
  const payload = asRecord(event.payload);
  switch (event.eventType) {
    case 'TARGET_CONFIRMED':
      return translate('targetAccepted');
    case 'SCENARIO_WORKER_TARGET':
      return translate('readerTargetPrepared', { count: formatInteger(payload.memberCount) });
    case 'SCENARIO_WORKER_STARTED':
      return translate('readerStarted', { count: formatInteger(payload.concurrency) });
    case 'SCENARIO_REQUEST_FAILED':
      return payload.timeout === true ? translate('readerDeadline') : translate('readerRequestFailed');
    case 'SCENARIO_WORKER_STOPPED':
      return workerSummary(readWorkerStats(event.payload), translate);
    case 'SCENARIO_WORKER_DRAINED':
      return translate('readerDrained', { count: formatInteger(payload.inFlight) });
    case 'RECOVERY_STARTED':
      return translate('recoveryStarted', { reason: safeText(payload.reason) || 'requested' });
    case 'RECOVERY_COMPLETED':
      return cleanupSummary(readCleanup(payload.result, payload.data), translate);
    case 'RECOVERY_FAILED':
      return translate('recoveryFailed');
    case 'MANUAL_CLEANUP_COMPLETED':
      return cleanupSummary(readCleanup(payload.result), translate);
    case 'MANUAL_CLEANUP_FAILED':
      return translate('cleanupFailed');
    case 'SCENARIO_WORKER_SETUP_FAILED':
      return translate('setupFailed');
    default:
      return translate('recordedEvent');
  }
}

export function formatBytes(value: number | undefined | null, locale = 'en', fallback = 'n/a'): string {
  if (!Number.isFinite(value) || value === undefined || value === null) return fallback;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let scaled = value;
  let unit = 'B';
  for (const nextUnit of units) {
    scaled /= 1024;
    unit = nextUnit;
    if (scaled < 1024 || nextUnit === units[units.length - 1]) break;
  }
  const displayValue = scaled >= 10 || Number.isInteger(scaled) ? Math.round(scaled) : Number(scaled.toFixed(1));
  return `${new Intl.NumberFormat(locale).format(displayValue)} ${unit}`;
}

export function formatHashNamespace(hashKey: string | undefined, faultRunId: string, fallback = 'run-scoped Hash'): string {
  const prefix = 'catalog:product-detail:operation:';
  if (!hashKey?.startsWith(prefix)) return fallback;
  return `${prefix}{${faultRunId.slice(0, 8)}}`;
}

export function formatMemberSkus(summary: FaultRunTargetSummary | null, translate: FaultRunTranslator = defaultTranslate): string {
  if (!summary) return translate('notAvailable');
  const visible = summary.memberSkus.slice(0, 3).join(', ');
  const remaining = summary.memberSkus.length - Math.min(summary.memberSkus.length, 3);
  return remaining > 0 ? `${visible} ${translate('moreMembers', { count: remaining })}` : visible;
}

function findTargetSummary(events: Event[], faultRunId: string): FaultRunTargetSummary | null {
  for (const event of [...events].reverse()) {
    if (event.eventType !== 'TARGET_CONFIRMED') continue;
    const payload = asRecord(event.payload);
    const candidate = asRecord(payload.targetSummary);
    const rawMemberSkus = Array.isArray(candidate.memberSkus) ? candidate.memberSkus : [];
    const memberSkus = rawMemberSkus.filter(
      (sku): sku is string => typeof sku === 'string' && SKU_PATTERN.test(sku));
    if (candidate.layout !== 'HASH'
      || typeof candidate.hashKey !== 'string'
      || candidate.hashKey !== `catalog:product-detail:operation:${faultRunId}`
      || !safeInteger(candidate.memberCount, 1)
      || memberSkus.length !== candidate.memberCount
      || memberSkus.some((sku, index) => sku !== rawMemberSkus[index])
      || new Set(memberSkus).size !== memberSkus.length
      || typeof candidate.probeSku !== 'string'
      || !SKU_PATTERN.test(candidate.probeSku)
      || memberSkus.includes(candidate.probeSku)
      || !safeInteger(candidate.memberSizeBytes, 256)
      || !safeInteger(candidate.logicalBytes, 1)
      || candidate.logicalBytes !== candidate.memberCount * candidate.memberSizeBytes
      || !safeInteger(candidate.keyTtlSec, 1)) {
      continue;
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
    if (safeInteger(candidate.observedBytes, 1)) summary.observedBytes = candidate.observedBytes;
    if (typeof candidate.expiresAt === 'string') summary.expiresAt = candidate.expiresAt;
    return summary;
  }
  return null;
}

function readWorkerStats(value: unknown): FaultRunWorkerStats | null {
  const candidate = asRecord(value);
  if (!safeInteger(candidate.requests, 0) || !safeInteger(candidate.successes, 0)
      || !safeInteger(candidate.failures, 0) || !safeInteger(candidate.timeouts, 0)
      || !safeInteger(candidate.inFlight, 0)) return null;
  const cacheResults: FaultRunWorkerStats['cacheResults'] = {};
  const rawCacheResults = asRecord(candidate.cacheResults);
  for (const key of CACHE_RESULT_KEYS) {
    if (safeInteger(rawCacheResults[key], 0)) cacheResults[key] = rawCacheResults[key];
  }
  return {
    requests: candidate.requests,
    successes: candidate.successes,
    failures: candidate.failures,
    timeouts: candidate.timeouts,
    inFlight: candidate.inFlight,
    stopReason: typeof candidate.stopReason === 'string' ? candidate.stopReason : null,
    averageLatencyMs: safeInteger(candidate.averageLatencyMs, 0) ? candidate.averageLatencyMs : 0,
    p50LatencyMs: safeInteger(candidate.p50LatencyMs, 0) ? candidate.p50LatencyMs : 0,
    p95LatencyMs: safeInteger(candidate.p95LatencyMs, 0) ? candidate.p95LatencyMs : 0,
    p99LatencyMs: safeInteger(candidate.p99LatencyMs, 0) ? candidate.p99LatencyMs : 0,
    cacheResults,
  };
}

function readDrain(value: unknown): FaultRunDrain | null {
  const candidate = asRecord(value);
  if (typeof candidate.registered !== 'boolean' || typeof candidate.drained !== 'boolean') return null;
  const result = candidate.result ? readWorkerStats(candidate.result) ?? undefined : undefined;
  return {
    registered: candidate.registered,
    drained: candidate.drained,
    ...(result ? { result } : {}),
    ...(typeof candidate.error === 'string' ? { error: 'Drain failed' } : {}),
  };
}

function readCleanup(...values: unknown[]): FaultRunCleanupResult | null {
  for (const value of values) {
    const source = findCleanupRecord(value);
    if (!source) continue;
    if (typeof source.hashRemoved !== 'boolean'
      && typeof source.released !== 'boolean'
      && typeof source.markerRemoved !== 'boolean') continue;
    return {
      ...(typeof source.hashRemoved === 'boolean' ? { hashRemoved: source.hashRemoved } : {}),
      ...(typeof source.released === 'boolean' ? { released: source.released } : {}),
      ...(typeof source.markerRemoved === 'boolean' ? { markerRemoved: source.markerRemoved } : {}),
      ...(typeof source.faultRunId === 'string' ? { faultRunId: source.faultRunId } : {}),
    };
  }
  return null;
}

function findCleanupRecord(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 3) return null;
  const candidate = asRecord(value);
  if (typeof candidate.hashRemoved === 'boolean'
    || typeof candidate.released === 'boolean'
    || typeof candidate.markerRemoved === 'boolean') return candidate;
  return findCleanupRecord(candidate.result, depth + 1)
    ?? findCleanupRecord(candidate.data, depth + 1);
}

function workerSummary(stats: FaultRunWorkerStats | null, translate: FaultRunTranslator): string {
  if (!stats) return translate('readerStopped');
  return translate('requestsCompleted', {
    successes: stats.successes,
    requests: stats.requests,
    latency: stats.p95LatencyMs,
  });
}

function cleanupSummary(cleanup: FaultRunCleanupResult | null, translate: FaultRunTranslator): string {
  if (!cleanup) return translate('recoveryCompleted');
  if (cleanup.hashRemoved === true && (cleanup.released === true || cleanup.markerRemoved === true)) {
    return translate('markerReleasedAndHashRemoved');
  }
  return cleanup.hashRemoved === true ? translate('hashRemoved') : translate('recoveryCompleted');
}

function safeInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeText(value: unknown): string {
  return typeof value === 'string' && value.length <= 64 ? value : '';
}

function formatInteger(value: unknown): string {
  return safeInteger(value, 0) ? String(value) : 'n/a';
}

const DEFAULT_FAULT_RUN_MESSAGES: Record<string, string> = {
  targetAccepted: 'Fixed target accepted the run',
  readerTargetPrepared: 'Reader target prepared with {count} members',
  readerStarted: 'Reader started at concurrency {count}',
  readerDeadline: 'A reader request reached its deadline',
  readerRequestFailed: 'A reader request failed',
  readerStopped: 'Reader stopped',
  readerDrained: 'Reader drained with {count} requests in flight',
  requestsCompleted: '{successes}/{requests} requests completed · p95 {latency} ms',
  recoveryStarted: 'Recovery started ({reason})',
  recoveryCompleted: 'Recovery completed',
  recoveryFailed: 'Recovery failed; inspect the protected recovery result',
  cleanupFailed: 'Per-run cleanup failed',
  setupFailed: 'Reader setup failed before traffic started',
  recordedEvent: 'Recorded Fault Run event',
  markerReleasedAndHashRemoved: 'Marker released and run Hash removed',
  hashRemoved: 'Run Hash removed',
  moreMembers: '+ {count} more',
};

function defaultTranslate(key: string, values?: Record<string, string | number>): string {
  const template = DEFAULT_FAULT_RUN_MESSAGES[key] || key;
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
}