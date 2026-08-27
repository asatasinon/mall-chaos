import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { getGatewayClient } from '@/lib/gateway-client';
import { getScenarioDefinition } from '@/lib/fault-run-catalog';
import { appendFaultRunEvent, loadFaultRun } from '@/lib/fault-run-repository';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { getOrCreateTraceId } from '@/lib/trace';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
  const { faultRunId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(faultRunId)) return jsonError(400, 'Invalid faultRunId', 400);
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
    return jsonError(400, 'A valid idempotency key is required', 400);
  }
  let confirmed = false;
  try {
    confirmed = (await request.json())?.confirmed === true;
  } catch {
    // An empty body is not confirmed and is rejected below.
  }
  if (!confirmed) return jsonError(400, 'Confirmation is required', 400);

  const run = await loadFaultRun(faultRunId);
  if (!run) return jsonError(404, 'Fault Run not found', 404);
  const definition = getScenarioDefinition(run.scenario);
  if (!definition.allowManualCleanup) return jsonError(403, 'Cleanup is not allowed for this scenario', 403);
  if (!['RECOVERED', 'STOPPED'].includes(run.state)) {
    return jsonError(409, 'Fault Run must be recovered before cleanup', 409);
  }

  const traceId = getOrCreateTraceId(request.headers);
  try {
    const result = await getGatewayClient().postInternal(
      '/internal/gateway/fault-runs/cleanup',
      {
        faultRunId: run.faultRunId,
        scenario: run.scenario,
        targetService: run.targetService,
        fencingToken: run.fencingToken,
      },
      traceId,
    );
    await appendFaultRunEvent(faultRunId, 'MANUAL_CLEANUP_COMPLETED', { result });
    await recordOperatorAudit({
      request,
      action: 'FAULT_RUN_CLEANUP',
      target: run.scenario,
      parameters: { faultRunId, idempotencyKey },
      result: 'SUCCESS',
      correlationId: traceId,
    });
    return jsonOk({ faultRunId, result });
  } catch {
    await appendFaultRunEvent(faultRunId, 'MANUAL_CLEANUP_FAILED', { targetService: run.targetService }).catch(() => undefined);
    await recordOperatorAudit({
      request,
      action: 'FAULT_RUN_CLEANUP',
      target: run.scenario,
      parameters: { faultRunId, idempotencyKey },
      result: 'FAILURE',
      correlationId: traceId,
    }).catch(() => undefined);
    return jsonError(502, 'Failed to clean Fault Run resources', 502);
  }
}