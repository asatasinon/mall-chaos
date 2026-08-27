import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { getFaultRunCoordinator } from '@/lib/fault-run-coordinator';
import { attachOperatorAudit } from '@/lib/fault-run-repository';
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
    const body = await request.json();
    confirmed = body?.confirmed === true;
  } catch {
    // An empty body is not confirmed and is rejected below.
  }
  if (!confirmed) return jsonError(400, 'Confirmation is required', 400);

  const traceId = getOrCreateTraceId(request.headers);
  try {
    const run = await getFaultRunCoordinator().stop(faultRunId);
    if (!run) return jsonError(404, 'Fault Run not found', 404);
    const auditId = await recordOperatorAudit({
      request,
      action: 'FAULT_RUN_STOP',
      target: run.scenario,
      parameters: { faultRunId, idempotencyKey },
      result: 'SUCCESS',
      correlationId: traceId,
    });
    await attachOperatorAudit(faultRunId, auditId);
    return jsonOk(run);
  } catch {
    await recordOperatorAudit({
      request,
      action: 'FAULT_RUN_STOP',
      parameters: { faultRunId, idempotencyKey },
      result: 'FAILURE',
      correlationId: traceId,
    }).catch(() => undefined);
    return jsonError(502, 'Failed to stop Fault Run', 502);
  }
}
