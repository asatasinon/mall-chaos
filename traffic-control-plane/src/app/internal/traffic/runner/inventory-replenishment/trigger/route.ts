import { randomUUID } from 'node:crypto';
import { jsonError, jsonOk } from '@/lib/api-response';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { runManualInventoryReplenishment } from '@/worker/inventory-replenishment';

export async function POST(request: Request) {
  const correlationId = randomUUID();
  try {
    const result = await runManualInventoryReplenishment(correlationId);
    if (result.lastResult !== 'COMPLETED') {
      await recordOperatorAudit({
        request,
        action: 'RUNNER_REPLENISHMENT_TRIGGER',
        target: 'inventory',
        result: 'FAILURE',
        correlationId,
      });
      return jsonError(503, 'Inventory replenishment did not complete', 503);
    }
    await recordOperatorAudit({
      request,
      action: 'RUNNER_REPLENISHMENT_TRIGGER',
      target: 'inventory',
      result: 'SUCCESS',
      correlationId,
    });
    return jsonOk({ type: 'inventory', correlationId, result });
  } catch {
    await recordOperatorAudit({
      request,
      action: 'RUNNER_REPLENISHMENT_TRIGGER',
      target: 'inventory',
      result: 'FAILURE',
      correlationId,
    }).catch(() => undefined);
    return jsonError(503, 'Unable to run inventory replenishment', 503);
  }
}
