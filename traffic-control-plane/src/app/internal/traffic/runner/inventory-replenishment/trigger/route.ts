import { randomUUID } from 'node:crypto';
import { jsonError, jsonOk } from '@/lib/api-response';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { enqueueReplenishmentCommand } from '@/lib/runtime-state';

export async function POST(request: Request) {
  const correlationId = randomUUID();
  try {
    await enqueueReplenishmentCommand('inventory', correlationId);
    await recordOperatorAudit({
      request,
      action: 'RUNNER_REPLENISHMENT_TRIGGER',
      target: 'inventory',
      result: 'SUCCESS',
      correlationId,
    });
    return jsonOk({ queued: true, type: 'inventory', correlationId }, 202);
  } catch {
    await recordOperatorAudit({
      request,
      action: 'RUNNER_REPLENISHMENT_TRIGGER',
      target: 'inventory',
      result: 'FAILURE',
      correlationId,
    }).catch(() => undefined);
    return jsonError(503, 'Unable to queue inventory replenishment', 503);
  }
}
