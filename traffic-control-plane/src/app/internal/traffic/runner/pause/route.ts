import { jsonOk } from '@/lib/api-response';
import { setRunnerPaused } from '@/lib/runtime-state';

export async function POST() {
  await setRunnerPaused(true);
  return jsonOk({ paused: true });
}
