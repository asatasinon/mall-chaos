import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';
import { loadRunnerConfigFromDb, updateRunnerConfigInDb } from '@/lib/runner-config';
import { recordOperatorAudit } from '@/lib/operator-audit';

export async function GET() {
  return jsonOk(await loadRunnerConfigFromDb());
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  if (!Number.isInteger(body?.version) || body.version < 1) {
    return jsonError(400, 'version is required', 400);
  }
  try {
    const result = await updateRunnerConfigInDb(body);
    await recordOperatorAudit({ request, action: 'RUNNER_CONFIG_UPDATE', parameters: body, result: 'SUCCESS' });
    return jsonOk(result);
  } catch (e: unknown) {
    await recordOperatorAudit({ request, action: 'RUNNER_CONFIG_UPDATE', parameters: body, result: 'FAILURE' });
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'VERSION_CONFLICT') {
      return jsonError(409, 'Config version conflict', 409);
    }
    if (message === 'INVALID_RUNNER_CONFIG' || message === 'INVALID_RUNNER_MIX_RULES') {
      return jsonError(400, 'Invalid runner configuration', 400);
    }
    return jsonError(500, message, 500);
  }
}
