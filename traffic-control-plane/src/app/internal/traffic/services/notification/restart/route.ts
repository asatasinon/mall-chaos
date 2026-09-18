import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { env } from '@/lib/env';
import {
  appendFaultRunEvent,
  hashFaultRunCommandIdempotencyKey,
  loadFaultRun,
  loadFaultRunEvents,
  type FaultRunRecord,
} from '@/lib/fault-run-repository';
import { getFaultRunCoordinator } from '@/lib/fault-run-coordinator';
import {
  type NotificationRestartResult,
  parseNotificationRestartSummary,
  restartNotificationService,
  summarizeNotificationRestartResult,
} from '@/lib/notification-restart-broker';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { buildFaultRunOperatorRun } from '@/lib/fault-run-operator-view';
import { isSafeRuntimeUnavailableHeapRun } from '@/lib/notification-restart-recovery';
import { getOrCreateTraceId } from '@/lib/trace';

export async function POST(request: NextRequest) {
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
    return jsonError(400, 'A valid idempotency key is required', 400);
  }
  const idempotencyKeyHash = hashFaultRunCommandIdempotencyKey(idempotencyKey);

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

  if (env.FAULT_RUN_SAFE_RUNTIME_ENABLED) {
    if (!run || !isSafeRuntimeUnavailableHeapRun(run)) {
      return jsonError(409, 'Notification restart requires the unavailable Fault Run recovery state', 409);
    }
  } else {
    if (run && run.scenario !== 'NOTIFICATION_HEAP_PRESSURE') {
      return jsonError(409, 'Notification restart is only available for an unavailable heap run', 409);
    }
    if (run && run.state !== 'SERVICE_UNAVAILABLE') {
      return jsonError(409, 'Notification restart is only available for an unavailable heap run', 409);
    }
  }

  const prior = run
    ? (await loadFaultRunEvents(run.faultRunId)).reverse()
      .find((event) => event.eventType === 'NOTIFICATION_RESTART_COMPLETED'
        && isRecord(event.payload)
        && event.payload.idempotencyKeyHash === idempotencyKeyHash)
    : undefined;
  if (prior && isRecord(prior.payload) && isRecord(prior.payload.result)) {
    try {
      const result = parseNotificationRestartSummary(prior.payload.result);
      if (result.healthy && run) {
        return jsonOk({
          faultRunId: run.faultRunId,
          result,
          run: buildFaultRunOperatorRun(run, {
            safeRuntimeEnabled: env.FAULT_RUN_SAFE_RUNTIME_ENABLED,
          }),
        });
      }
      return jsonError(504, 'Notification service did not become healthy before the restart deadline', 504);
    } catch {
      return jsonError(409, 'Stored notification restart result is invalid', 409);
    }
  }

  const traceId = getOrCreateTraceId(request.headers);
  let result: NotificationRestartResult;
  try {
    result = await restartNotificationService({
      ...(run ? { runId: run.faultRunId, fencingToken: run.fencingToken } : {}),
      traceId,
    });
  } catch {
    return recordRestartFailure(request, run, idempotencyKeyHash, traceId);
  }

  const summary = summarizeNotificationRestartResult(result);
  let recovered = run;
  try {
    if (run && result.healthy && !env.FAULT_RUN_SAFE_RUNTIME_ENABLED) {
      recovered = await getFaultRunCoordinator().markServiceRecovered(run.faultRunId, { result }) || run;
    }
    if (run) {
      await appendFaultRunEvent(run.faultRunId, 'NOTIFICATION_RESTART_COMPLETED', {
        result: summary,
        recovered: !env.FAULT_RUN_SAFE_RUNTIME_ENABLED && recovered?.state === 'RECOVERED',
        idempotencyKeyHash,
      });
    }
    await recordOperatorAudit({
      request,
      action: 'NOTIFICATION_SERVICE_RESTART',
      target: 'notification-service',
      parameters: {
        ...(run ? { faultRunId: run.faultRunId } : {}),
        idempotencyKeyHash,
        restarted: result.restarted,
      },
      result: result.healthy ? 'SUCCESS' : 'FAILURE',
      correlationId: traceId,
    });
    return result.healthy
      ? jsonOk({
        faultRunId: run?.faultRunId ?? null,
        result: summary,
        run: recovered
          ? buildFaultRunOperatorRun(recovered, {
            safeRuntimeEnabled: env.FAULT_RUN_SAFE_RUNTIME_ENABLED,
          })
          : null,
      })
      : jsonError(504, 'Notification service did not become healthy before the restart deadline', 504);
  } catch {
    return jsonError(502, 'Failed to record notification restart result', 502);
  }
}

async function recordRestartFailure(
  request: NextRequest,
  run: FaultRunRecord | null,
  idempotencyKeyHash: string,
  traceId: string,
): Promise<Response> {
  try {
    if (run) {
      await appendFaultRunEvent(run.faultRunId, 'NOTIFICATION_RESTART_FAILED', {
        idempotencyKeyHash,
      });
    }
    await recordOperatorAudit({
      request,
      action: 'NOTIFICATION_SERVICE_RESTART',
      target: 'notification-service',
      parameters: { ...(run ? { faultRunId: run.faultRunId } : {}), idempotencyKeyHash },
      result: 'FAILURE',
      correlationId: traceId,
    });
    return jsonError(502, 'Failed to restart notification service', 502);
  } catch {
    return jsonError(502, 'Failed to record notification restart failure', 502);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}