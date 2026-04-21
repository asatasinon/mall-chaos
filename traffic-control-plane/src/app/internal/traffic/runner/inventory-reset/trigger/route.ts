import { getInventoryResetScheduler } from '@/worker/inventory-reset';
import { jsonOk } from '@/lib/api-response';

export async function POST() {
  const scheduler = getInventoryResetScheduler();
  const result = await scheduler.triggerNow();
  return jsonOk(result);
}
