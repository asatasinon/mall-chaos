import { env } from './env';

export interface NotificationRestartResult {
  accepted: boolean;
  target: 'notification-service';
  mode: 'compose' | 'kubernetes';
  restarted: boolean;
  healthy: boolean;
  healthStatus: string;
  elapsedMs: number;
}

export class NotificationRestartBrokerError extends Error {
  constructor(public readonly status: number, message = 'Notification restart broker failed') {
    super(message);
    this.name = 'NotificationRestartBrokerError';
  }
}

export async function restartNotificationService(input: {
  faultRunId?: string;
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
        ...(input.faultRunId ? { faultRunId: input.faultRunId, fencingToken: input.fencingToken } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new NotificationRestartBrokerError(response.status);
    const result = await response.json() as Partial<NotificationRestartResult>;
    if (result.accepted !== true || result.target !== 'notification-service'
      || typeof result.mode !== 'string' || typeof result.restarted !== 'boolean'
      || typeof result.healthy !== 'boolean'
        || typeof result.healthStatus !== 'string' || typeof result.elapsedMs !== 'number') {
      throw new NotificationRestartBrokerError(502, 'Invalid notification restart broker response');
    }
    return result as NotificationRestartResult;
  } catch (error) {
    if (error instanceof NotificationRestartBrokerError) throw error;
    throw new NotificationRestartBrokerError(502, 'Notification restart broker unavailable');
  } finally {
    clearTimeout(timeout);
  }
}