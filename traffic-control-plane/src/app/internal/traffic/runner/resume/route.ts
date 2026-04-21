import { jsonOk } from '@/lib/api-response';
import { setRunnerPaused } from '@/lib/runtime-state';

export async function POST() {
  await setRunnerPaused(false);
  return jsonOk({ paused: false });
}
