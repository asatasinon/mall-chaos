import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';
import { loadRunnerConfigFromDb, updateRunnerConfigInDb } from '@/lib/runner-config';

export async function GET() {
  return jsonOk(await loadRunnerConfigFromDb());
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  if (typeof body?.version !== 'number') {
    return jsonError(400, 'version is required', 400);
  }
  try {
    const result = await updateRunnerConfigInDb(body);
    return jsonOk(result);
  } catch (e: any) {
    if (e.message === 'VERSION_CONFLICT') {
      return jsonError(409, 'Config version conflict', 409);
    }
    return jsonError(500, e.message, 500);
  }
}
