import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AlertSourceKind, loadAlertSource, saveAlertSource } from '@/lib/alert-config';
import { recordOperatorAudit } from '@/lib/operator-audit';

function isKind(value: unknown): value is AlertSourceKind {
  return value === 'prometheus-rules' || value === 'alertmanager';
}

export async function GET(request: NextRequest) {
  try {
    const kind = request.nextUrl.searchParams.get('kind');
    if (!isKind(kind)) return jsonError(400, 'INVALID_ALERT_SOURCE_KIND', 400);
    return jsonOk(await loadAlertSource(kind));
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : 'ALERT_SOURCE_LOAD_FAILED', 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isKind(body.kind)) return jsonError(400, 'INVALID_ALERT_SOURCE_KIND', 400);
    const result = await saveAlertSource(body.kind, Number(body.version), String(body.yaml ?? ''));
    await recordOperatorAudit({ request, action: 'ALERT_SOURCE_UPDATE', target: body.kind, parameters: { version: body.version }, result: 'SUCCESS' });
    return jsonOk(result);
  } catch (error) {
    await recordOperatorAudit({ request, action: 'ALERT_SOURCE_UPDATE', result: 'FAILURE' });
    const message = error instanceof Error ? error.message : 'ALERT_SOURCE_SAVE_FAILED';
    const status = message === 'VERSION_CONFLICT' ? 409 : message.endsWith('_RELOAD_UNREACHABLE') || message.endsWith('_RELOAD_FAILED') ? 502 : 400;
    return jsonError(status, message, status);
  }
}