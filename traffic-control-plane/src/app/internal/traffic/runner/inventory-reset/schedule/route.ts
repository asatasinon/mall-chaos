import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';
import { loadResetPolicyFromDb, updateResetPolicyInDb } from '@/lib/reset-policy';
import { signalInventoryPolicyReload } from '@/lib/runtime-state';
import { recordOperatorAudit } from '@/lib/operator-audit';

export async function GET() {
  return jsonOk(await loadResetPolicyFromDb());
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  if (typeof body?.version !== 'number') {
    return jsonError(400, 'version is required', 400);
  }
  try {
    const result = await updateResetPolicyInDb(body);
    await signalInventoryPolicyReload();
    await recordOperatorAudit({ request, action: 'INVENTORY_RESET_POLICY_UPDATE', parameters: body, result: 'SUCCESS' });
    return jsonOk(result);
  } catch (e: any) {
    await recordOperatorAudit({ request, action: 'INVENTORY_RESET_POLICY_UPDATE', parameters: body, result: 'FAILURE' });
    if (e.message === 'VERSION_CONFLICT') {
      return jsonError(409, 'Policy version conflict', 409);
    }
    return jsonError(500, e.message, 500);
  }
}
