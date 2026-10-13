import type { Pool } from 'mysql2/promise';
import { getPool } from './db';
import type { EvidenceSourceConfig } from './evidence-web-config';
import {
  EvidenceTypeError,
  parseEvidenceSqlTimestamp,
  type EvidenceCoverage,
  type EvidenceItemAvailability,
  type EvidencePredicateOutcome,
  type EvidenceResolvedWindow,
  type RenderedEvidenceRecipe,
} from './evidence-types';
import { resolveEvidenceWindowExecution } from './evidence-window-resolver';

export type EvidenceQueryPreflightErrorCode =
  | 'EVIDENCE_QUERY_PREFLIGHT_INVALID_RECIPE'
  | 'EVIDENCE_DATABASE_TIME_UNAVAILABLE'
  | 'EVIDENCE_DATABASE_TIME_INVALID';

export class EvidenceQueryPreflightError extends Error {
  constructor(readonly code: EvidenceQueryPreflightErrorCode) {
    super(code);
    this.name = 'EvidenceQueryPreflightError';
  }
}

export interface EvidenceQueryPreflight {
  readonly canonicalStartAt: string | null;
  readonly canonicalEndAt: string | null;
  readonly executedStartAt: string | null;
  readonly executedEndAt: string | null;
  readonly shouldQuery: boolean;
  readonly windowSettled: boolean;
  readonly availabilityHint: EvidenceItemAvailability | null;
  readonly coverageHint: EvidenceCoverage | null;
  readonly predicateOutcome: EvidencePredicateOutcome | null;
  readonly reasonCodes: readonly string[];
}

export function preflightEvidenceQuery(
  recipe: RenderedEvidenceRecipe,
  window: EvidenceResolvedWindow,
  source: EvidenceSourceConfig,
  databaseNow: string,
): EvidenceQueryPreflight {
  if ((recipe.source !== 'PROMETHEUS' && recipe.source !== 'LOKI' && recipe.source !== 'TEMPO')
    || recipe.observationMode !== 'WINDOWED'
    || recipe.renderedQuery === null
    || !Number.isSafeInteger(recipe.lookbackSec) || recipe.lookbackSec < 0
    || !Number.isSafeInteger(source.retentionSec) || source.retentionSec < 1) {
    throw new EvidenceQueryPreflightError('EVIDENCE_QUERY_PREFLIGHT_INVALID_RECIPE');
  }
  const nowMs = timestampMilliseconds(databaseNow);
  const canonicalStartAt = window.canonicalStartAt;
  const canonicalEndAt = window.canonicalEndAt;
  if (window.state !== 'READY' || canonicalStartAt === null || canonicalEndAt === null) {
    const notApplicable = window.state === 'NOT_APPLICABLE';
    return {
      canonicalStartAt,
      canonicalEndAt,
      executedStartAt: null,
      executedEndAt: null,
      shouldQuery: false,
      windowSettled: false,
      availabilityHint: notApplicable ? 'NOT_APPLICABLE' : 'EVIDENCE_UNAVAILABLE',
      coverageHint: notApplicable ? 'NOT_APPLICABLE' : 'NONE',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCodes: [window.reasonCode ?? 'WINDOW_NOT_READY'],
    };
  }

  const startMs = timestampMilliseconds(canonicalStartAt);
  const endMs = timestampMilliseconds(canonicalEndAt);
  if (endMs <= startMs) {
    const rangePlan = resolveEvidenceWindowExecution(window, databaseNow);
    return {
      canonicalStartAt,
      canonicalEndAt,
      executedStartAt: null,
      executedEndAt: null,
      shouldQuery: false,
      windowSettled: rangePlan.windowSettled,
      availabilityHint: null,
      coverageHint: 'NONE',
      predicateOutcome: 'INCONCLUSIVE',
      reasonCodes: [rangePlan.reasonCode ?? 'ZERO_LENGTH_WINDOW'],
    };
  }

  const retentionStartMs = nowMs - source.retentionSec * 1000;
  const rangePlan = resolveEvidenceWindowExecution(window, databaseNow);
  if (endMs < retentionStartMs) {
    return noQuery(rangePlan, 'EVIDENCE_UNAVAILABLE', 'RETENTION_EXPIRED');
  }
  if (source.baseUrl === null) {
    return noQuery(rangePlan, 'EVIDENCE_UNAVAILABLE', 'SOURCE_UNCONFIGURED');
  }

  const lookbackMs = recipe.lookbackSec * 1000;
  const completeInputStartMs = retentionStartMs + lookbackMs;
  const executedStartMs = Math.max(startMs, completeInputStartMs);
  if (endMs <= executedStartMs) {
    return noQuery(rangePlan, 'EVIDENCE_UNAVAILABLE', 'RETENTION_LOOKBACK_EXPIRED');
  }
  const executedEndMs = Math.min(endMs, nowMs);
  if (executedEndMs <= executedStartMs) {
    return noQuery(rangePlan, null, 'WINDOW_NOT_SETTLED');
  }

  const reasonCodes: string[] = [];
  const retentionPartial = executedStartMs > startMs;
  if (retentionPartial) {
    reasonCodes.push(lookbackMs > 0 ? 'RETENTION_LOOKBACK_PARTIAL' : 'RETENTION_PARTIAL');
  }
  if (!rangePlan.windowSettled) reasonCodes.push('WINDOW_NOT_SETTLED');
  const partial = reasonCodes.length > 0;
  return {
    canonicalStartAt,
    canonicalEndAt,
    executedStartAt: new Date(executedStartMs).toISOString(),
    executedEndAt: new Date(executedEndMs).toISOString(),
    shouldQuery: true,
    windowSettled: rangePlan.windowSettled,
    availabilityHint: null,
    coverageHint: partial ? 'PARTIAL' : null,
    predicateOutcome: partial ? 'INCONCLUSIVE' : null,
    reasonCodes,
  };
}

export async function loadEvidenceDatabaseNow(
  pool: Pick<Pool, 'query'> = getPool(),
): Promise<string> {
  const [rows] = await pool.query('SELECT CURRENT_TIMESTAMP(3) AS database_now');
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])
    || rows[0].database_now === null || rows[0].database_now === undefined) {
    throw new EvidenceQueryPreflightError('EVIDENCE_DATABASE_TIME_UNAVAILABLE');
  }
  try {
    return parseEvidenceSqlTimestamp(rows[0].database_now);
  } catch (error) {
    if (error instanceof EvidenceTypeError) {
      throw new EvidenceQueryPreflightError('EVIDENCE_DATABASE_TIME_INVALID');
    }
    throw error;
  }
}

function noQuery(
  rangePlan: ReturnType<typeof resolveEvidenceWindowExecution>,
  availabilityHint: EvidenceItemAvailability | null,
  reasonCode: string,
): EvidenceQueryPreflight {
  return {
    canonicalStartAt: rangePlan.canonicalStartAt,
    canonicalEndAt: rangePlan.canonicalEndAt,
    executedStartAt: null,
    executedEndAt: null,
    shouldQuery: false,
    windowSettled: rangePlan.windowSettled,
    availabilityHint,
    coverageHint: 'NONE',
    predicateOutcome: 'INCONCLUSIVE',
    reasonCodes: [reasonCode],
  };
}

function timestampMilliseconds(value: string): number {
  try {
    return Date.parse(parseEvidenceSqlTimestamp(value));
  } catch (error) {
    if (error instanceof EvidenceTypeError) {
      throw new EvidenceQueryPreflightError('EVIDENCE_QUERY_PREFLIGHT_INVALID_RECIPE');
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
