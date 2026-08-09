import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { loadAlertConfig, parseAlertmanagerYaml, saveAlertConfig } from '@/lib/alert-config';

export async function GET() {
  try {
    return jsonOk(await loadAlertConfig());
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : 'ALERT_CONFIG_LOAD_FAILED', 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    return jsonOk(await saveAlertConfig(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ALERT_CONFIG_SAVE_FAILED';
    const status = message === 'VERSION_CONFLICT' ? 409 : message.endsWith('_RELOAD_UNREACHABLE') || message.endsWith('_RELOAD_FAILED') ? 502 : 400;
    return jsonError(status, message, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const current = await loadAlertConfig();
    const parsed = parseAlertmanagerYaml(String(body.yaml ?? ''), { ...current, version: Number(body.version ?? current.version) });
    return jsonOk(await saveAlertConfig(parsed));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ALERTMANAGER_IMPORT_FAILED';
    const status = message === 'VERSION_CONFLICT' ? 409 : message.endsWith('_RELOAD_UNREACHABLE') || message.endsWith('_RELOAD_FAILED') ? 502 : 400;
    return jsonError(status, message, status);
  }
}
