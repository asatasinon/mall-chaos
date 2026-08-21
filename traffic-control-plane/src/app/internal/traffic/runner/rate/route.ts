import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';
import { setRunnerRateMultiplier } from '@/lib/runtime-state';
import { recordOperatorAudit } from '@/lib/operator-audit';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const multiplier = body?.multiplier;
  if (typeof multiplier !== 'number' || multiplier <= 0) {
    return jsonError(400, 'multiplier must be a positive number', 400);
  }
  await setRunnerRateMultiplier(multiplier);
  await recordOperatorAudit({ request, action: 'RUNNER_RATE_UPDATE', parameters: { multiplier }, result: 'SUCCESS' });
  return jsonOk({ multiplier });
}
