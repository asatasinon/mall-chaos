import { jsonOk } from '@/lib/api-response';
import { getCouponReplenishmentStatus } from '@/lib/runtime-state';

export async function GET() {
  return jsonOk(await getCouponReplenishmentStatus());
}