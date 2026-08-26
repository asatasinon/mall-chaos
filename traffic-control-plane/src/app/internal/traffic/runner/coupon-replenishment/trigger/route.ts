import { randomUUID } from 'node:crypto';
import { jsonError, jsonOk } from '@/lib/api-response';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { enqueueReplenishmentCommand } from '@/lib/runtime-state';

export async function POST(request: Request) {
  const correlationId = randomUUID();
  try {
    await enqueueReplenishmentCommand('coupon', correlationId);
    await recordOperatorAudit({
      request,
      action: 'RUNNER_REPLENISHMENT_TRIGGER',
      target: 'coupon',
      result: 'SUCCESS',
      correlationId,
    });
    return jsonOk({ queued: true, type: 'coupon', correlationId }, 202);
  } catch {
    await recordOperatorAudit({
      request,
      action: 'RUNNER_REPLENISHMENT_TRIGGER',
      target: 'coupon',
      result: 'FAILURE',
      correlationId,
    }).catch(() => undefined);
    return jsonError(503, 'Unable to queue coupon replenishment', 503);
  }
}
