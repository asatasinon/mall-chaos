import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import {
  AlertReceiptPayloadError,
  hasServiceKey,
  parseAlertmanagerWebhookBody,
} from '@/lib/alertmanager-webhook';
import {
  ensureAlertReceiptSchema,
  saveAlertReceipts,
} from '@/lib/alert-receipt';
import { recordOperatorAudit } from '@/lib/operator-audit';

export async function POST(request: NextRequest) {
  if (!hasServiceKey(request)) {
    await recordReceiptAudit(request, 'ALERT_RECEIPT_AUTH_FAILURE', 'FAILURE');
    return jsonError(401, 'ALERT_RECEIPT_AUTHENTICATION_FAILED', 401);
  }

  try {
    const receipts = parseAlertmanagerWebhookBody(await request.text());
    await ensureAlertReceiptSchema();
    const result = await saveAlertReceipts(receipts);
    await recordReceiptAudit(request, 'ALERT_RECEIPT_RECEIVED', 'SUCCESS', undefined, {
      alertCount: receipts.length,
      accepted: result.accepted,
      duplicates: result.duplicates,
      statuses: [...new Set(receipts.map((receipt) => receipt.status))].sort(),
    });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof AlertReceiptPayloadError) {
      await recordReceiptAudit(request, 'ALERT_RECEIPT_REJECTED', 'FAILURE', error.code);
      return jsonError(error.status, error.code, error.status);
    }
    await recordReceiptAudit(request, 'ALERT_RECEIPT_STORAGE_FAILURE', 'FAILURE');
    return jsonError(503, 'ALERT_RECEIPT_STORAGE_UNAVAILABLE', 503);
  }
}

async function recordReceiptAudit(
  request: NextRequest,
  action: string,
  result: 'SUCCESS' | 'FAILURE',
  failureCode?: string,
  parameters?: Record<string, unknown>,
): Promise<void> {
  await recordOperatorAudit({
    request,
    action,
    parameters: failureCode ? { failureCode, ...parameters } : parameters,
    result,
  }).catch(() => undefined);
}
