import { jsonOk } from '@/lib/api-response';
import { signalInventoryResetTrigger } from '@/lib/runtime-state';

export async function POST() {
  await signalInventoryResetTrigger();
  return jsonOk({ accepted: true });
}
