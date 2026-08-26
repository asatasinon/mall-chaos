import { env } from './env';
import { getPool } from './db';

export interface LifecycleAccount {
  label: string;
  email: string;
  password: string;
  expectedCustomerId?: number;
  enabled: boolean;
}

export interface LifecycleAccountSummary {
  label: string;
  enabled: boolean;
  expectedCustomerId?: number;
}

interface LoginIdentityResponse {
  userId?: unknown;
}

export function loadLifecycleAccounts(): LifecycleAccount[] {
  return parseLifecycleAccounts(env.TRAFFIC_LIFECYCLE_ACCOUNTS);
}

export async function loadLifecycleAccountsWithState(): Promise<LifecycleAccount[]> {
  const accounts = loadLifecycleAccounts();
  const accountsWithIds = accounts.filter((account) => account.expectedCustomerId !== undefined);
  if (accountsWithIds.length === 0) return accounts;

  const ids = accountsWithIds.map((account) => account.expectedCustomerId!);
  const placeholders = ids.map(() => '?').join(', ');
  try {
    const [rows] = await getPool().query(
      `SELECT customer_id, enabled
       FROM runner_customer_whitelist
       WHERE customer_id IN (${placeholders})`,
      ids,
    );
    const enabledByCustomerId = new Map(
      (rows as Array<{ customer_id: number; enabled: number }>).map((row) => [
        Number(row.customer_id),
        Number(row.enabled) === 1,
      ]),
    );
    return accounts.map((account) => account.expectedCustomerId === undefined
      ? account
      : { ...account, enabled: enabledByCustomerId.get(account.expectedCustomerId) ?? account.enabled });
  } catch {
    throw new Error('LIFECYCLE_ACCOUNT_STATE_UNAVAILABLE');
  }
}

export async function setLifecycleAccountEnabled(label: string, enabled: boolean): Promise<LifecycleAccount[]> {
  const account = loadLifecycleAccounts().find((candidate) => candidate.label === label);
  if (!account) throw new Error('LIFECYCLE_ACCOUNT_NOT_FOUND');
  if (account.expectedCustomerId === undefined) {
    throw new Error('LIFECYCLE_ACCOUNT_CUSTOMER_ID_REQUIRED');
  }

  const current = await loadLifecycleAccountsWithState();
  if (!enabled && current.filter((candidate) => candidate.enabled).length <= 1) {
    throw new Error('LIFECYCLE_ACCOUNT_LAST_ENABLED');
  }

  try {
    await getPool().query(
      `INSERT INTO runner_customer_whitelist (customer_id, enabled, version)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), version = version + 1`,
      [account.expectedCustomerId, enabled ? 1 : 0],
    );
  } catch {
    throw new Error('LIFECYCLE_ACCOUNT_STATE_UNAVAILABLE');
  }
  return loadLifecycleAccountsWithState();
}

export function parseLifecycleAccounts(raw: string): LifecycleAccount[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('INVALID_LIFECYCLE_ACCOUNTS');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('INVALID_LIFECYCLE_ACCOUNTS');
  }

  const accounts = parsed.map((value) => parseAccount(value));
  const labels = new Set<string>();
  const emails = new Set<string>();
  for (const account of accounts) {
    const normalisedEmail = account.email.toLowerCase();
    if (labels.has(account.label) || emails.has(normalisedEmail)) {
      throw new Error('DUPLICATE_LIFECYCLE_ACCOUNT');
    }
    labels.add(account.label);
    emails.add(normalisedEmail);
  }

  if (accounts.length === 0) {
    throw new Error('NO_LIFECYCLE_ACCOUNT');
  }
  return accounts;
}

export function validateLoginIdentity(
  account: LifecycleAccount,
  response: LoginIdentityResponse,
): number {
  if (!account.enabled || !Number.isInteger(response.userId) || Number(response.userId) <= 0) {
    throw new Error('LIFECYCLE_LOGIN_IDENTITY_INVALID');
  }
  const customerId = Number(response.userId);
  if (account.expectedCustomerId !== undefined && account.expectedCustomerId !== customerId) {
    throw new Error('LIFECYCLE_CUSTOMER_ID_MISMATCH');
  }
  return customerId;
}

export function summariseLifecycleAccounts(accounts: LifecycleAccount[]): LifecycleAccountSummary[] {
  return accounts.map(({ label, enabled, expectedCustomerId }) => ({
    label,
    enabled,
    ...(expectedCustomerId === undefined ? {} : { expectedCustomerId }),
  }));
}

function parseAccount(value: unknown): LifecycleAccount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_LIFECYCLE_ACCOUNT');
  }
  const account = value as Record<string, unknown>;
  const label = typeof account.label === 'string' ? account.label.trim() : '';
  const email = typeof account.email === 'string' ? account.email.trim().toLowerCase() : '';
  const password = typeof account.password === 'string' ? account.password : '';
  const enabled = true;
  const expectedCustomerId = account.expectedCustomerId;
  if (!label || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || password.length < 8
      || (expectedCustomerId !== undefined
        && (!Number.isInteger(expectedCustomerId) || Number(expectedCustomerId) <= 0))) {
    throw new Error('INVALID_LIFECYCLE_ACCOUNT');
  }
  return {
    label,
    email,
    password,
    enabled,
    ...(expectedCustomerId === undefined ? {} : { expectedCustomerId: Number(expectedCustomerId) }),
  };
}