import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { loadAlertConfig, saveAlertConfig } from '@/lib/alert-config';

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
    const status = message === 'VERSION_CONFLICT' ? 409 : 400;
    return jsonError(status, message, status);
  }
}
