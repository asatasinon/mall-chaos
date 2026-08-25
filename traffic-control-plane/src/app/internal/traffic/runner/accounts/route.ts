import { jsonError, jsonOk } from '@/lib/api-response';
import {
  loadLifecycleAccounts,
  summariseLifecycleAccounts,
} from '@/lib/lifecycle-accounts';

export async function GET() {
  try {
    const accounts = loadLifecycleAccounts();
    return jsonOk({
      loginEnabled: process.env.TRAFFIC_LIFECYCLE_LOGIN_ENABLED === 'true',
      count: accounts.length,
      enabledCount: accounts.filter((account) => account.enabled).length,
      accounts: summariseLifecycleAccounts(accounts),
    });
  } catch {
    return jsonError(503, 'Lifecycle login configuration is unavailable', 503);
  }
}