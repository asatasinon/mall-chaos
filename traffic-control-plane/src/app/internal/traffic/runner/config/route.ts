import { getRunnerEngine } from '@/worker/runner-engine';
import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';

export async function GET() {
  const engine = getRunnerEngine();
  const config = engine.getConfig();
  return jsonOk(config);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  if (typeof body?.version !== 'number') {
    return jsonError(400, 'version is required', 400);
  }
  const engine = getRunnerEngine();
  try {
    const result = await engine.updateConfig(body);
    return jsonOk(result);
  } catch (e: any) {
    if (e.message === 'VERSION_CONFLICT') {
      return jsonError(409, 'Config version conflict', 409);
    }
    return jsonError(500, e.message, 500);
  }
}
