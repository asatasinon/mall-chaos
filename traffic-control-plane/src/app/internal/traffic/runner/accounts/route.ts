import { jsonError, jsonOk } from '@/lib/api-response';
import { NextRequest } from 'next/server';
import {
  loadLifecycleAccountsWithState,
  setLifecycleAccountEnabled,
  summariseLifecycleAccounts,
} from '@/lib/lifecycle-accounts';

export async function GET() {
  try {
    const accounts = await loadLifecycleAccountsWithState();
    return jsonOk({
      count: accounts.length,
      enabledCount: accounts.filter((account) => account.enabled).length,
      accounts: summariseLifecycleAccounts(accounts),
    });
  } catch {
    return jsonError(503, 'Lifecycle login configuration is unavailable', 503);
  }
}

export async function PATCH(request: NextRequest) {
  let body: { label?: unknown; enabled?: unknown };
  try {
    body = await request.json() as { label?: unknown; enabled?: unknown };
  } catch {
    return jsonError(400, 'Account label and enabled state are required', 400);
  }
  if (typeof body.label !== 'string' || typeof body.enabled !== 'boolean') {
    return jsonError(400, 'Account label and enabled state are required', 400);
  }

  try {
    const accounts = await setLifecycleAccountEnabled(body.label, body.enabled);
    return jsonOk({
      count: accounts.length,
      enabledCount: accounts.filter((account) => account.enabled).length,
      accounts: summariseLifecycleAccounts(accounts),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LIFECYCLE_ACCOUNT_STATE_UNAVAILABLE';
    if (code === 'LIFECYCLE_ACCOUNT_NOT_FOUND') return jsonError(404, 'Lifecycle account not found', 404);
    if (code === 'LIFECYCLE_ACCOUNT_LAST_ENABLED') return jsonError(409, 'At least one lifecycle account must remain enabled', 409);
    if (code === 'LIFECYCLE_ACCOUNT_CUSTOMER_ID_REQUIRED') return jsonError(400, 'Lifecycle account customer id is required', 400);
    return jsonError(503, 'Lifecycle account state is unavailable', 503);
  }
}