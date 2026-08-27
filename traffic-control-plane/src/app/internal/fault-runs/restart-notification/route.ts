import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { getGatewayClient } from '@/lib/gateway-client';
import { getScenarioDefinition } from '@/lib/fault-run-catalog';
import { appendFaultRunEvent, loadFaultRun } from '@/lib/fault-run-repository';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { getOrCreateTraceId } from '@/lib/trace';
import { getFaultRunCoordinator } from '@/lib/fault-run-coordinator';

export async function POST(request: NextRequest) {
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
    return jsonError(400, 'A valid idempotency key is required', 400);
  }
  let body: { faultRunId?: unknown; confirmed?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'faultRunId and confirmation are required', 400);
  }
  if (body.confirmed !== true || typeof body.faultRunId !== 'string'
      || !/^[0-9a-f-]{36}$/i.test(body.faultRunId)) {
    return jsonError(400, 'faultRunId and confirmation are required', 400);
  }
  const run = await loadFaultRun(body.faultRunId);
  if (!run) return jsonError(404, 'Fault Run not found', 404);
  if (run.scenario !== 'NOTIFICATION_HEAP_PRESSURE'
      || run.state !== 'SERVICE_UNAVAILABLE') {
    return jsonError(409, 'Notification restart is only available for an unavailable heap run', 409);
  }
  getScenarioDefinition(run.scenario);

  const traceId = getOrCreateTraceId(request.headers);
  try {
    const result = await getGatewayClient().postInternal(
      '/internal/gateway/fault-runs/restart-notification',
      { faultRunId: run.faultRunId, fencingToken: run.fencingToken },
      traceId,
    );
    const recovered = await getFaultRunCoordinator().markServiceRecovered(run.faultRunId, { result });
    await appendFaultRunEvent(run.faultRunId, 'NOTIFICATION_RESTART_COMPLETED', { result, recovered: recovered?.state === 'RECOVERED' });
    await recordOperatorAudit({
      request,
      action: 'NOTIFICATION_SERVICE_RESTART',
      target: 'notification-service',
      parameters: { faultRunId: run.faultRunId, idempotencyKey },
      result: 'SUCCESS',
      correlationId: traceId,
    });
    return jsonOk({ faultRunId: run.faultRunId, result, run: recovered });
  } catch {
    await appendFaultRunEvent(run.faultRunId, 'NOTIFICATION_RESTART_FAILED').catch(() => undefined);
    await recordOperatorAudit({
      request,
      action: 'NOTIFICATION_SERVICE_RESTART',
      target: 'notification-service',
      parameters: { faultRunId: run.faultRunId, idempotencyKey },
      result: 'FAILURE',
      correlationId: traceId,
    }).catch(() => undefined);
    return jsonError(502, 'Failed to restart notification service', 502);
  }
}