import { jsonOk } from '@/lib/api-response';
import { getInventoryReplenishmentStatus } from '@/lib/runtime-state';

export async function GET() {
  return jsonOk(await getInventoryReplenishmentStatus());
}