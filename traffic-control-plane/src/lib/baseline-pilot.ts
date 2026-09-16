import {
  isBaselineObservationStatus,
  isPilotReviewDecision,
  type BaselineAlertRule,
  type BaselineLimitation,
  type ScenarioBaseline,
  type PilotReviewDecision,
} from './baseline-schema';
import { getScenarioDefinition, type FaultRunScenario } from './fault-run-catalog';

const MAX_PILOT_REVIEW_BYTES = 8 * 1024;

export class BaselinePilotValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'BaselinePilotValidationError';
  }
}

export interface PilotReviewInput {
  scenario: FaultRunScenario;
  catalogRevision: string;
  decision: PilotReviewDecision;
  alertRules: BaselineAlertRule[];
  evidenceRequirements: BaselineLimitation[];
  retentionSnapshot: Record<string, string | number | boolean | null>;
  remediationBoundary: string;
  decisionReason: string;
}

export function parsePilotReviewInput(
  scenarioValue: string,
  body: unknown,
  currentCatalogRevision: string,
): PilotReviewInput {
  getScenarioDefinition(scenarioValue);
  const scenario = scenarioValue as FaultRunScenario;
  if (!isRecord(body)) throw new BaselinePilotValidationError('INVALID_PILOT_REVIEW');
  assertAllowedKeys(body, [
    'confirmed',
    'catalogRevision',
    'decision',
    'alertRules',
    'evidenceRequirements',
    'retentionSnapshot',
    'remediationBoundary',
    'decisionReason',
  ], 'INVALID_PILOT_REVIEW');
  assertPayloadSize(body);
  if (body.confirmed !== true) {
    throw new BaselinePilotValidationError('PILOT_REVIEW_CONFIRMATION_REQUIRED');
  }
  if (typeof body.catalogRevision !== 'string' || body.catalogRevision !== currentCatalogRevision) {
    throw new BaselinePilotValidationError('PILOT_REVIEW_CONFLICT');
  }
  if (!isPilotReviewDecision(body.decision)) {
    throw new BaselinePilotValidationError('INVALID_PILOT_REVIEW_DECISION');
  }
  const decisionReason = parseRequiredText(body.decisionReason, 'INVALID_PILOT_REVIEW_REASON', 2000);
  assertSafeReviewText(decisionReason, 'INVALID_PILOT_REVIEW_REASON');
  return {
    scenario,
    catalogRevision: currentCatalogRevision,
    decision: body.decision,
    alertRules: parseAlertRules(body.alertRules),
    evidenceRequirements: parseEvidenceRequirements(body.evidenceRequirements),
    retentionSnapshot: parseRetentionSnapshot(body.retentionSnapshot),
    remediationBoundary: parseRemediationBoundary(body.remediationBoundary),
    decisionReason,
  };
}

export function assertPilotSelectionEligible(
  baselines: readonly ScenarioBaseline[],
): void {
  const baseline = baselines.find((candidate) =>
    candidate.captureStatus === 'COMPLETE' || candidate.captureStatus === 'COMPLETE_WITH_LIMITATIONS');
  if (!baseline) throw new BaselinePilotValidationError('PILOT_BASELINE_REQUIRED');
  if (baseline.knownLimitations.some((limitation) => [
    'DISPATCH_UNVERIFIED',
    'MISSING_RUNTIME_EVENT',
    'COUNTER_INCONSISTENT',
    'OBSERVATION_UNAVAILABLE',
    'ALERT_RECEIPT_UNVERIFIED',
    'CATALOG_REVISION_FAILED',
    'CLEANUP_UNVERIFIED',
    'MANUAL_CLEANUP_REQUIRED',
    'NON_RELEASING_RESOURCE_BOUNDARY',
    'BUSINESS_RECOVERY_UNCONFIRMED',
  ].includes(limitation.code))) {
    throw new BaselinePilotValidationError('PILOT_BASELINE_INCOMPLETE');
  }
  if (baseline.outcome.businessRecovered !== 'YES'
      || ['FAILED', 'UNKNOWN', 'MANUAL_REQUIRED'].includes(baseline.outcome.resourceCleanup)) {
    throw new BaselinePilotValidationError('PILOT_BASELINE_INCOMPLETE');
  }
  if (baseline.observationSummary.retention !== 'CHECKED'
      || baseline.alertSummary.status !== 'AVAILABLE'
      || !isAvailable(baseline.observationSummary.prometheus.status)
      || !isAvailable(baseline.observationSummary.loki.status)
      || !isAvailable(baseline.observationSummary.tempo.status)
      || baseline.alertSummary.rules.length === 0
      || baseline.alertSummary.rules.some((rule) => rule.observed !== 'AVAILABLE')) {
    throw new BaselinePilotValidationError('PILOT_EVIDENCE_UNAVAILABLE');
  }
}

function parseAlertRules(value: unknown): BaselineAlertRule[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new BaselinePilotValidationError('INVALID_PILOT_ALERT_RULES');
  }
  return value.map((item) => {
    if (!isRecord(item)) throw new BaselinePilotValidationError('INVALID_PILOT_ALERT_RULES');
    assertAllowedKeys(item, ['name', 'threshold', 'duration', 'declared', 'observed'], 'INVALID_PILOT_ALERT_RULES');
    const name = parseRequiredText(item.name, 'INVALID_PILOT_ALERT_RULES', 128);
    const threshold = parseOptionalText(item.threshold, 'INVALID_PILOT_ALERT_RULES', 256);
    const duration = parseOptionalText(item.duration, 'INVALID_PILOT_ALERT_RULES', 128);
    const declared = parseOptionalBoolean(item.declared, 'INVALID_PILOT_ALERT_RULES');
    const observed = item.observed;
    if (observed !== null && observed !== undefined && !isBaselineObservationStatus(observed)) {
      throw new BaselinePilotValidationError('INVALID_PILOT_ALERT_RULES');
    }
    return { name, threshold, duration, declared, observed: observed ?? 'UNKNOWN' };
  });
}

function parseEvidenceRequirements(value: unknown): BaselineLimitation[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new BaselinePilotValidationError('INVALID_PILOT_EVIDENCE');
  }
  return value.map((item) => {
    if (!isRecord(item)) throw new BaselinePilotValidationError('INVALID_PILOT_EVIDENCE');
    assertAllowedKeys(item, ['code', 'detail'], 'INVALID_PILOT_EVIDENCE');
    const detail = parseOptionalText(item.detail, 'INVALID_PILOT_EVIDENCE', 512);
    if (detail) assertSafeReviewText(detail, 'INVALID_PILOT_EVIDENCE');
    return {
      code: parseRequiredText(item.code, 'INVALID_PILOT_EVIDENCE', 128),
      detail,
    };
  });
}

function parseRetentionSnapshot(
  value: unknown,
): Record<string, string | number | boolean | null> {
  if (!isRecord(value)) throw new BaselinePilotValidationError('INVALID_PILOT_RETENTION');
  const entries = Object.entries(value);
  if (entries.length > 32) throw new BaselinePilotValidationError('INVALID_PILOT_RETENTION');
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)
        || /(?:authorization|cookie|password|secret|token|api[_-]?key|raw|response|sql|shell|command)/i.test(key)
        || (typeof item !== 'string' && typeof item !== 'number'
          && typeof item !== 'boolean' && item !== null)
        || (typeof item === 'string' && item.length > 256)
        || (typeof item === 'number' && !Number.isFinite(item))) {
      throw new BaselinePilotValidationError('INVALID_PILOT_RETENTION');
    }
    if (typeof item === 'string') assertSafeReviewText(item, 'INVALID_PILOT_RETENTION');
    result[key] = item;
  }
  return result;
}

function parseRemediationBoundary(value: unknown): string {
  const boundary = parseRequiredText(value, 'INVALID_REMEDIATION_BOUNDARY', 2000);
  assertSafeReviewText(boundary, 'INVALID_REMEDIATION_BOUNDARY');
  return boundary;
}

function parseRequiredText(value: unknown, code: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new BaselinePilotValidationError(code);
  }
  return value.trim();
}

function assertSafeReviewText(value: string, code: string): void {
  if (/(?:```|[;&|`$<>]|\b(?:fault\s*run|stop(?:ping)?|release|cleanup|agent)\b|\b(?:kubectl|docker|curl|wget|mysql|redis-cli|pnpm|npm|bash|sh|python|node|rm|chmod|chown)\b|\b(?:select|insert|update|delete|drop|alter|truncate|create)\s+|\b(?:authorization|cookie|bearer|password|secret|token|api[_-]?key)\b)/i.test(value)) {
    throw new BaselinePilotValidationError(code);
  }
}

function parseOptionalText(value: unknown, code: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return parseRequiredText(value, code, maxLength);
}

function parseOptionalBoolean(value: unknown, code: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new BaselinePilotValidationError(code);
  return value;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  code: string,
): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new BaselinePilotValidationError(code);
  }
}

function assertPayloadSize(value: Record<string, unknown>): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new BaselinePilotValidationError('INVALID_PILOT_REVIEW');
  }
  if (serialized === undefined) {
    throw new BaselinePilotValidationError('INVALID_PILOT_REVIEW');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PILOT_REVIEW_BYTES) {
    throw new BaselinePilotValidationError('INVALID_PILOT_REVIEW');
  }
}

function isAvailable(value: unknown): value is 'AVAILABLE' {
  return value === 'AVAILABLE';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
