import { jsonOk } from '@/lib/api-response';
import { setRunnerPaused } from '@/lib/runtime-state';
import { recordOperatorAudit } from '@/lib/operator-audit';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  await setRunnerPaused(false);
  await recordOperatorAudit({ request, action: 'RUNNER_RESUME', result: 'SUCCESS' });
  return jsonOk({ paused: false });
}
