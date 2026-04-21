import { getRunnerEngine } from '@/worker/runner-engine';
import { jsonOk } from '@/lib/api-response';

export async function POST() {
  const engine = getRunnerEngine();
  engine.resume();
  return jsonOk({ paused: false });
}
