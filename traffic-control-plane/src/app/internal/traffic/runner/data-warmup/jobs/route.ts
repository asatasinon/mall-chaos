import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { recordOperatorAudit } from '@/lib/operator-audit';
import {
  enqueueManualWarmupJob,
  loadManualWarmupJobs,
  type ManualWarmupOperation,
} from '@/worker/data-warmup';

const TABLE_NAMES = ['product_price_history', 'user_behavior_log'] as const;

export async function GET() {
  try {
    return jsonOk({ jobs: await loadManualWarmupJobs() });
  } catch {
    return jsonError(503, 'Data warmup jobs are unavailable', 503);
  }
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const operation = body.operation;
    const tableName = body.tableName;
    const dates = body.dates;
    const rowsPerDay = body.rowsPerDay;
    if ((operation !== 'INJECT' && operation !== 'CLEANUP')
      || typeof tableName !== 'string'
      || !TABLE_NAMES.includes(tableName as typeof TABLE_NAMES[number])
      || !Array.isArray(dates)
      || !dates.every((date): date is string => typeof date === 'string')
      || (operation === 'CLEANUP' && body.confirmed !== true)) {
      return jsonError(400, 'Invalid data warmup job request', 400);
    }
    const jobId = await enqueueManualWarmupJob({
      operation: operation as ManualWarmupOperation,
      tableName,
      dates,
      rowsPerDay: operation === 'INJECT' && typeof rowsPerDay === 'number' ? rowsPerDay : 0,
    });
    await recordOperatorAudit({
      request,
      action: operation === 'INJECT' ? 'DATA_WARMUP_INJECT' : 'DATA_WARMUP_CLEANUP',
      target: tableName,
      parameters: { dates, rowsPerDay: operation === 'INJECT' ? rowsPerDay : 0 },
      result: 'SUCCESS',
      correlationId,
    });
    return jsonOk({ queued: true, jobId, operation, tableName, dates }, 202);
  } catch (error) {
    await recordOperatorAudit({
      request,
      action: 'DATA_WARMUP_JOB',
      result: 'FAILURE',
      correlationId,
    }).catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Unable to queue data warmup job';
    const validationError = message.startsWith('INVALID_');
    return jsonError(validationError ? 400 : 503, validationError ? message : 'Unable to queue data warmup job', validationError ? 400 : 503);
  }
}
