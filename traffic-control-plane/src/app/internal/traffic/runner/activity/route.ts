import { jsonOk } from '@/lib/api-response';
import { getRunnerActivity } from '@/lib/runtime-state';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);
  const activity = await getRunnerActivity(limit);
  return jsonOk(activity);
}
