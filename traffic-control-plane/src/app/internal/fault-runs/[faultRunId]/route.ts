import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { loadFaultRun, loadFaultRunAudit, loadFaultRunEvents } from '@/lib/fault-run-repository';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(faultRunId)) return jsonError(400, 'Invalid faultRunId', 400);
  const run = await loadFaultRun(faultRunId);
  if (!run) return jsonError(404, 'Fault Run not found', 404);
  const [events, audit] = await Promise.all([
    loadFaultRunEvents(faultRunId),
    loadFaultRunAudit(faultRunId),
  ]);
  return jsonOk({ run, events, audit });
}
