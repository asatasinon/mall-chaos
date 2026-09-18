import { env } from './env';

export interface NotificationRestartResult {
  accepted: boolean;
  target: 'notification-service';
  mode: 'compose' | 'kubernetes';
  restarted: boolean;
  healthy: boolean;
  healthStatus: 'UP' | 'UNREACHABLE' | `HTTP_${number}`;
  elapsedMs: number;
}

export interface NotificationRestartSummary {
  restarted: boolean;
  healthy: boolean;
  healthStatus: 'UP' | 'UNREACHABLE' | `HTTP_${number}`;
}

export class NotificationRestartBrokerError extends Error {
  constructor(public readonly status: number, message = 'Notification restart broker failed') {
    super(message);
    this.name = 'NotificationRestartBrokerError';
  }
}

export async function restartNotificationService(input: {
  runId?: string;
  fencingToken?: number;
  traceId: string;
}): Promise<NotificationRestartResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 130_000);
  try {
    const response = await fetch(`${env.NOTIFICATION_RESTART_BROKER_URL.replace(/\/$/, '')}/restart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Restart-Broker-Key': env.NOTIFICATION_RESTART_BROKER_KEY,
        'X-Trace-Id': input.traceId,
      },
      body: JSON.stringify({
        ...(input.runId ? { runId: input.runId, fencingToken: input.fencingToken } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new NotificationRestartBrokerError(response.status);
    return parseNotificationRestartResult(await response.json());
  } catch (error) {
    if (error instanceof NotificationRestartBrokerError) throw error;
    throw new NotificationRestartBrokerError(502, 'Notification restart broker unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

export function parseNotificationRestartResult(value: unknown): NotificationRestartResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NotificationRestartBrokerError(502, 'Invalid notification restart broker response');
  }
  const result = value as Record<string, unknown>;
  const elapsedMs = result.elapsedMs;
  if (result.accepted !== true
    || result.target !== 'notification-service'
    || (result.mode !== 'compose' && result.mode !== 'kubernetes')
    || typeof result.restarted !== 'boolean'
    || typeof result.healthy !== 'boolean'
    || !isHealthStatus(result.healthStatus)
    || typeof elapsedMs !== 'number'
    || !Number.isSafeInteger(elapsedMs)
    || elapsedMs < 0
    || elapsedMs > 130_000) {
    throw new NotificationRestartBrokerError(502, 'Invalid notification restart broker response');
  }
  return {
    accepted: true,
    target: 'notification-service',
    mode: result.mode,
    restarted: result.restarted,
    healthy: result.healthy,
    healthStatus: result.healthStatus,
    elapsedMs,
  };
}

export function summarizeNotificationRestartResult(
  result: NotificationRestartResult,
): NotificationRestartSummary {
  return {
    restarted: result.restarted,
    healthy: result.healthy,
    healthStatus: result.healthStatus,
  };
}

export function parseNotificationRestartSummary(value: unknown): NotificationRestartSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NotificationRestartBrokerError(502, 'Invalid notification restart summary');
  }
  const result = value as Record<string, unknown>;
  if (typeof result.restarted !== 'boolean'
    || typeof result.healthy !== 'boolean'
    || !isHealthStatus(result.healthStatus)) {
    throw new NotificationRestartBrokerError(502, 'Invalid notification restart summary');
  }
  return {
    restarted: result.restarted,
    healthy: result.healthy,
    healthStatus: result.healthStatus,
  };
}

function isHealthStatus(value: unknown): value is NotificationRestartResult['healthStatus'] {
  return value === 'UP' || value === 'UNREACHABLE' || /^HTTP_[1-5]\d{2}$/.test(String(value));
}