import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { getGatewayClient } from '@/lib/gateway-client';
import { getScenarioDefinition } from '@/lib/fault-run-catalog';
import { loadActiveFaultRun } from '@/lib/fault-run-repository';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { getOrCreateTraceId } from '@/lib/trace';

export async function POST(request: NextRequest) {
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  if (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
    return jsonError(400, 'A valid idempotency key is required', 400);
  }

  let scenario = '';
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.scenario !== 'string' || body.confirmed !== true) {
      return jsonError(400, 'A scenario is required', 400);
    }
    scenario = body.scenario;
    const definition = getScenarioDefinition(scenario);
    if (!definition.allowManualCleanup) return jsonError(403, 'Cleanup is not allowed for this scenario', 403);
  } catch (error) {
    return jsonError(400, errorMessage(error), 400);
  }

  const activeRun = await loadActiveFaultRun();
  if (activeRun) return jsonError(409, 'Stop the active Fault Run before cleanup', 409);

  const traceId = getOrCreateTraceId(request.headers);
  try {
    const result = await getGatewayClient().postInternal(
      '/internal/gateway/operations/cleanup-all',
      { operation: 'notification-storage' },
      traceId,
    );
    await recordOperatorAudit({
      request,
      action: 'FAULT_RUN_SCENARIO_CLEANUP',
      target: scenario,
      parameters: { scenario, idempotencyKey },
      result: 'SUCCESS',
      correlationId: traceId,
    });
    return jsonOk({ scenario, result });
  } catch (error) {
    await recordOperatorAudit({
      request,
      action: 'FAULT_RUN_SCENARIO_CLEANUP',
      target: scenario,
      parameters: { scenario, idempotencyKey },
      result: 'FAILURE',
      correlationId: traceId,
    }).catch(() => undefined);
    return jsonError(502, error instanceof Error ? error.message : 'Failed to clean scenario data', 502);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Invalid scenario cleanup request';
}
