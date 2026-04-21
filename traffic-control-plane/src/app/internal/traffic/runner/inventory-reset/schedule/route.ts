import { getInventoryResetScheduler } from '@/worker/inventory-reset';
import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';

export async function GET() {
  const scheduler = getInventoryResetScheduler();
  return jsonOk(scheduler.getPolicy());
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  if (typeof body?.version !== 'number') {
    return jsonError(400, 'version is required', 400);
  }
  const scheduler = getInventoryResetScheduler();
  try {
    const result = await scheduler.updatePolicy(body);
    return jsonOk(result);
  } catch (e: any) {
    if (e.message === 'VERSION_CONFLICT') {
      return jsonError(409, 'Policy version conflict', 409);
    }
    return jsonError(500, e.message, 500);
  }
}
