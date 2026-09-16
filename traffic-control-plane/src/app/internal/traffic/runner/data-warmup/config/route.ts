import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { recordOperatorAudit } from '@/lib/operator-audit';
import {
  loadDataWarmupConfig,
  updateDataWarmupConfig,
  type DataWarmupConfigUpdate,
} from '@/lib/data-warmup-config';

const IMPACT_FIELDS = new Set(['windowDays', 'rowsPerDay', 'targetRows']);

export async function GET() {
  try {
    return jsonOk(await loadDataWarmupConfig());
  } catch {
    return jsonError(503, 'Data warmup configuration is unavailable', 503);
  }
}

export async function PUT(request: NextRequest) {
  const correlationId = randomUUID();
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return jsonError(400, 'Invalid data warmup configuration', 400);
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return jsonError(400, 'Invalid data warmup configuration', 400);
  }
  const body = parsedBody as Record<string, unknown>;

  const current = await loadDataWarmupConfig().catch(() => null);
  const hasImpactingChange = current !== null
    && [...IMPACT_FIELDS].some((field) => body[field] !== undefined
      && body[field] !== current[field as keyof typeof current]);
  if (hasImpactingChange && body.confirmed !== true) {
    await recordOperatorAudit({
      request,
      action: 'DATA_WARMUP_CONFIG_UPDATE',
      parameters: body,
      result: 'FAILURE',
      correlationId,
    }).catch(() => undefined);
    return jsonError(409, 'Data warmup configuration change requires confirmation', 409);
  }

  const update = { ...body };
  delete update.confirmed;
  try {
    const operatorIdHeader = request.headers.get('x-operator-id');
    const operatorId = operatorIdHeader && /^\d+$/.test(operatorIdHeader) ? Number(operatorIdHeader) : null;
    const result = await updateDataWarmupConfig(update as unknown as DataWarmupConfigUpdate, operatorId);
    await recordOperatorAudit({
      request,
      action: 'DATA_WARMUP_CONFIG_UPDATE',
      parameters: body,
      result: 'SUCCESS',
      correlationId,
    });
    return jsonOk(result);
  } catch (error) {
    await recordOperatorAudit({
      request,
      action: 'DATA_WARMUP_CONFIG_UPDATE',
      parameters: body,
      result: 'FAILURE',
      correlationId,
    }).catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Unable to update data warmup configuration';
    if (message === 'VERSION_CONFLICT') return jsonError(409, 'Config version conflict', 409);
    if (message.startsWith('INVALID_')) return jsonError(400, 'Invalid data warmup configuration', 400);
    return jsonError(503, 'Unable to update data warmup configuration', 503);
  }
}
