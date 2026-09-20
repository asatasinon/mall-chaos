import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import {
  updateDataWarmupEnabled,
  type DataWarmupEnabledUpdate,
} from '@/lib/data-warmup-config';
import { recordOperatorAudit } from '@/lib/operator-audit';

export async function PATCH(request: NextRequest) {
  const correlationId = randomUUID();
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return jsonError(400, 'Invalid data warmup enabled state', 400);
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return jsonError(400, 'Invalid data warmup enabled state', 400);
  }

  const body = parsedBody as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'version' && key !== 'enabled')
      || typeof body.version !== 'number'
      || !Number.isInteger(body.version)
      || body.version < 1
      || typeof body.enabled !== 'boolean') {
    return jsonError(400, 'Invalid data warmup enabled state', 400);
  }
  const update: DataWarmupEnabledUpdate = { version: body.version, enabled: body.enabled };

  try {
    const operatorIdHeader = request.headers.get('x-operator-id');
    const operatorId = operatorIdHeader && /^\d+$/.test(operatorIdHeader) ? Number(operatorIdHeader) : null;
    const result = await updateDataWarmupEnabled(update, operatorId);
    await recordOperatorAudit({
      request,
      action: 'DATA_WARMUP_ENABLED_UPDATE',
      parameters: body,
      result: 'SUCCESS',
      correlationId,
    });
    return jsonOk(result);
  } catch (error) {
    await recordOperatorAudit({
      request,
      action: 'DATA_WARMUP_ENABLED_UPDATE',
      parameters: body,
      result: 'FAILURE',
      correlationId,
    }).catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Unable to update data warmup enabled state';
    if (message === 'VERSION_CONFLICT') return jsonError(409, 'Config version conflict', 409);
    if (message.startsWith('INVALID_')) return jsonError(400, 'Invalid data warmup enabled state', 400);
    return jsonError(503, 'Unable to update data warmup enabled state', 503);
  }
}
