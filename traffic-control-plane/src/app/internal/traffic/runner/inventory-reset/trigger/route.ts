import { jsonOk } from '@/lib/api-response';
import { signalInventoryResetTrigger } from '@/lib/runtime-state';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  await signalInventoryResetTrigger();
  await recordOperatorAudit({ request, action: 'INVENTORY_RESET_TRIGGER', result: 'SUCCESS' });
  return jsonOk({ accepted: true });
}
