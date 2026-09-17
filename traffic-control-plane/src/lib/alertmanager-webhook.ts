import crypto from 'node:crypto';
import { env } from './env';
import type { AlertReceiptInput, AlertReceiptStatus } from './alert-receipt';

const MAX_WEBHOOK_BYTES = 256 * 1024;
const ALERT_STATUSES = new Set<AlertReceiptStatus>(['firing', 'resolved']);
const SEVERITIES = new Set(['critical', 'warning', 'info']);

interface AlertmanagerWebhook {
  status?: unknown;
  receiver?: unknown;
  alerts?: unknown;
}

interface AlertmanagerAlert {
  status?: unknown;
  labels?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  fingerprint?: unknown;
}

export class AlertReceiptPayloadError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 413,
  ) {
    super(code);
    this.name = 'AlertReceiptPayloadError';
  }
}

export function hasServiceKey(
  request: Pick<Request, 'headers'>,
  expected = env.CASTREL_INTERNAL_SERVICE_KEY,
): boolean {
  if (!expected) return false;
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const supplied = bearer ?? request.headers.get('x-internal-service-key');
  if (!supplied) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return expectedBytes.length === suppliedBytes.length
    && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

export function parseAlertmanagerWebhookBody(text: string): AlertReceiptInput[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_WEBHOOK_BYTES) {
    throw new AlertReceiptPayloadError('ALERT_RECEIPT_PAYLOAD_TOO_LARGE', 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AlertReceiptPayloadError('INVALID_ALERTMANAGER_PAYLOAD', 400);
  }
  return parseAlertmanagerWebhook(body);
}

export function parseAlertmanagerWebhook(value: unknown): AlertReceiptInput[] {
  if (!isRecord(value)) throw new AlertReceiptPayloadError('INVALID_ALERTMANAGER_PAYLOAD', 400);
  const payload = value as AlertmanagerWebhook;
  const receiver = boundedName(payload.receiver, 'receiver');
  const topStatus = readStatus(payload.status);
  if (!topStatus) throw new AlertReceiptPayloadError('INVALID_ALERTMANAGER_STATUS', 400);
  if (!Array.isArray(payload.alerts) || payload.alerts.length === 0 || payload.alerts.length > 100) {
    throw new AlertReceiptPayloadError('INVALID_ALERTMANAGER_ALERTS', 400);
  }

  return payload.alerts.map((value) => {
    if (!isRecord(value)) throw new AlertReceiptPayloadError('INVALID_ALERTMANAGER_ALERT', 400);
    const alert = value as AlertmanagerAlert;
    const labels = isRecord(alert.labels) ? alert.labels : null;
    if (!labels) throw new AlertReceiptPayloadError('INVALID_ALERTMANAGER_LABELS', 400);
    const alertName = boundedName(labels.alertname, 'alertname');
    const fingerprint = boundedFingerprint(alert.fingerprint);
    const startsAt = parseTimestamp(alert.startsAt, 'startsAt');
    const endsAt = parseEndTimestamp(alert.endsAt);
    if (endsAt && endsAt < startsAt) {
      throw new AlertReceiptPayloadError('INVALID_ALERTMANAGER_TIMESTAMP', 400);
    }
    const status = readStatus(alert.status) ?? topStatus;
    const severity = readSeverity(labels.severity);
    const service = readOptionalLabel(labels.service);
    return {
      fingerprint,
      status,
      receiver,
      alertName,
      severity,
      service,
      startsAt,
      endsAt,
    };
  });
}

function readStatus(value: unknown): AlertReceiptStatus | null {
  return typeof value === 'string' && ALERT_STATUSES.has(value as AlertReceiptStatus)
    ? value as AlertReceiptStatus : null;
}

function readSeverity(value: unknown): AlertReceiptInput['severity'] {
  return typeof value === 'string' && SEVERITIES.has(value)
    ? value as AlertReceiptInput['severity'] : 'unknown';
}

function boundedName(value: unknown, field: string): string {
  if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) return value;
  throw new AlertReceiptPayloadError(`INVALID_ALERTMANAGER_${field.toUpperCase()}`, 400);
}

function boundedFingerprint(value: unknown): string {
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) return value;
  throw new AlertReceiptPayloadError('INVALID_ALERTMANAGER_FINGERPRINT', 400);
}

function readOptionalLabel(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) ? value : null;
}

function parseTimestamp(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new AlertReceiptPayloadError(`INVALID_ALERTMANAGER_${field.toUpperCase()}`, 400);
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()) || timestamp.getUTCFullYear() < 1000) {
    throw new AlertReceiptPayloadError(`INVALID_ALERTMANAGER_${field.toUpperCase()}`, 400);
  }
  return timestamp;
}

function parseEndTimestamp(value: unknown): Date | null {
  if (value === undefined || value === null || value === ''
      || (typeof value === 'string' && /^0001-01-01T00:00:00(?:\.000)?Z$/.test(value))) return null;
  return parseTimestamp(value, 'endsAt');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
