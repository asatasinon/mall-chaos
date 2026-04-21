import { getRunnerEngine } from '@/worker/runner-engine';
import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const multiplier = body?.multiplier;
  if (typeof multiplier !== 'number' || multiplier <= 0) {
    return jsonError(400, 'multiplier must be a positive number', 400);
  }
  const engine = getRunnerEngine();
  engine.setRateMultiplier(multiplier);
  return jsonOk({ multiplier });
}
