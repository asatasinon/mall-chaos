import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { env } from '@/lib/env';
import {
  loadFaultRun,
  loadFaultRunAudit,
  loadFaultRunAudits,
  loadFaultRunEvents,
} from '@/lib/fault-run-repository';
import { buildFaultRunOperatorDetails } from '@/lib/fault-run-operator-view';
import { listFaultRunActions } from '@/lib/fault-run-action-repository';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(faultRunId)) return jsonError(400, 'Invalid faultRunId', 400);
  const run = await loadFaultRun(faultRunId);
  if (!run) return jsonError(404, 'Fault Run not found', 404);
  const [events, audit, audits, actions] = await Promise.all([
    loadFaultRunEvents(faultRunId),
    loadFaultRunAudit(faultRunId),
    loadFaultRunAudits(faultRunId),
    listFaultRunActions(faultRunId).catch((error: unknown) => {
      if (error instanceof Error
        && error.message.startsWith('FAULT_RUN_OWNERSHIP_MIGRATION_REQUIRED')) return [];
      throw error;
    }),
  ]);
  return jsonOk(buildFaultRunOperatorDetails(run, events, audit, audits, {
    safeRuntimeEnabled: env.FAULT_RUN_SAFE_RUNTIME_ENABLED,
  }, actions));
}
