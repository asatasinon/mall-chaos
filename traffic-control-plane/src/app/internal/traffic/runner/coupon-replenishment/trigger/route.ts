import { randomUUID } from 'node:crypto';
import { jsonError, jsonOk } from '@/lib/api-response';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { runManualCouponReplenishment } from '@/worker/coupon-replenishment';

export async function POST(request: Request) {
  const correlationId = randomUUID();
  try {
    const result = await runManualCouponReplenishment(correlationId);
    if (result.lastResult !== 'COMPLETED') {
      await recordOperatorAudit({
        request,
        action: 'RUNNER_REPLENISHMENT_TRIGGER',
        target: 'coupon',
        result: 'FAILURE',
        correlationId,
      });
      return jsonError(503, 'Coupon replenishment did not complete', 503);
    }
    await recordOperatorAudit({
      request,
      action: 'RUNNER_REPLENISHMENT_TRIGGER',
      target: 'coupon',
      result: 'SUCCESS',
      correlationId,
    });
    return jsonOk({ type: 'coupon', correlationId, result });
  } catch {
    await recordOperatorAudit({
      request,
      action: 'RUNNER_REPLENISHMENT_TRIGGER',
      target: 'coupon',
      result: 'FAILURE',
      correlationId,
    }).catch(() => undefined);
    return jsonError(503, 'Unable to run coupon replenishment', 503);
  }
}
