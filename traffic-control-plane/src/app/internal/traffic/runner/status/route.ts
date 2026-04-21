import { getRunnerEngine } from '@/worker/runner-engine';
import { jsonOk } from '@/lib/api-response';

export async function GET() {
  const engine = getRunnerEngine();
  return jsonOk(engine.getStatus());
}
