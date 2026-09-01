import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { getScenarioDefinition } from '@/lib/fault-run-catalog';
import { appendFaultRunEvent, loadFaultRun, loadFaultRunEvents } from '@/lib/fault-run-repository';
import { getFaultRunCoordinator } from '@/lib/fault-run-coordinator';
import { restartNotificationService } from '@/lib/notification-restart-broker';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { getOrCreateTraceId } from '@/lib/trace';

export async function POST(request: NextRequest) {
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
    return jsonError(400, 'A valid idempotency key is required', 400);
  }

  let body: { faultRunId?: unknown; confirmed?: unknown };
  try {
    body = await request.json() as { faultRunId?: unknown; confirmed?: unknown };
  } catch {
    return jsonError(400, 'Confirmation is required', 400);
  }
  if (body.confirmed !== true || (body.faultRunId !== undefined
      && (typeof body.faultRunId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.faultRunId)))) {
    return jsonError(400, 'Confirmation is required', 400);
  }

  const run = typeof body.faultRunId === 'string' ? await loadFaultRun(body.faultRunId) : null;
  if (body.faultRunId !== undefined && !run) return jsonError(404, 'Fault Run not found', 404);
  if (run && run.scenario !== 'NOTIFICATION_HEAP_PRESSURE') {
    return jsonError(409, 'Notification restart is only available for an unavailable heap run', 409);
  }
  if (run && run.state !== 'SERVICE_UNAVAILABLE') {
    return jsonError(409, 'Notification restart is only available for an unavailable heap run', 409);
  }
  if (run) getScenarioDefinition(run.scenario);

  const prior = run
    ? (await loadFaultRunEvents(run.faultRunId)).reverse()
      .find((event) => event.eventType === 'NOTIFICATION_RESTART_COMPLETED'
        && isRecord(event.payload) && event.payload.idempotencyKey === idempotencyKey)
    : undefined;
  if (prior && isRecord(prior.payload) && isRecord(prior.payload.result)) {
    const result = prior.payload.result as { healthy?: unknown };
    if (result.healthy === true && run) return jsonOk({ faultRunId: run.faultRunId, result, run });
    return jsonError(504, 'Notification service did not become healthy before the restart deadline', 504);
  }

  const traceId = getOrCreateTraceId(request.headers);
  try {
    const result = await restartNotificationService({
      ...(run ? { faultRunId: run.faultRunId, fencingToken: run.fencingToken } : {}),
      traceId,
    });
    let recovered = run;
    if (run && result.healthy) recovered = await getFaultRunCoordinator().markServiceRecovered(run.faultRunId, { result }) || run;
    if (run) await appendFaultRunEvent(run.faultRunId, 'NOTIFICATION_RESTART_COMPLETED', {
      result,
      recovered: recovered?.state === 'RECOVERED',
      idempotencyKey,
    });
    await recordOperatorAudit({
      request,
      action: 'NOTIFICATION_SERVICE_RESTART',
      target: 'notification-service',
      parameters: { ...(run ? { faultRunId: run.faultRunId } : {}), idempotencyKey, restarted: result.restarted },
      result: result.healthy ? 'SUCCESS' : 'FAILURE',
      correlationId: traceId,
    });
    return result.healthy
      ? jsonOk({ faultRunId: run?.faultRunId ?? null, result, run: recovered })
      : jsonError(504, 'Notification service did not become healthy before the restart deadline', 504);
  } catch {
    if (run) await appendFaultRunEvent(run.faultRunId, 'NOTIFICATION_RESTART_FAILED', { idempotencyKey }).catch(() => undefined);
    await recordOperatorAudit({
      request,
      action: 'NOTIFICATION_SERVICE_RESTART',
      target: 'notification-service',
      parameters: { ...(run ? { faultRunId: run.faultRunId } : {}), idempotencyKey },
      result: 'FAILURE',
      correlationId: traceId,
    }).catch(() => undefined);
    return jsonError(502, 'Failed to restart notification service', 502);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}