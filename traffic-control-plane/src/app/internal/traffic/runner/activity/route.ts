import { jsonOk } from '@/lib/api-response';
import { getRunnerActivity } from '@/lib/runtime-state';
import { loadTrafficActionsByLifecycleId } from '@/lib/runner-persistence';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trafficRunId = searchParams.get('trafficRunId');
  const lifecycleId = searchParams.get('lifecycleId');
  if (trafficRunId && lifecycleId) {
    return jsonOk(await loadTrafficActionsByLifecycleId(trafficRunId, lifecycleId));
  }
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);
  const activity = await getRunnerActivity(limit);
  return jsonOk(activity);
}
