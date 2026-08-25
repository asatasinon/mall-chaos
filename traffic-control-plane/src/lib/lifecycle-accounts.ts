import { env } from './env';

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
  return parseLifecycleAccounts(env.TRAFFIC_LIFECYCLE_ACCOUNTS, env.TRAFFIC_LIFECYCLE_LOGIN_ENABLED);
}

export function parseLifecycleAccounts(raw: string, loginEnabled: boolean): LifecycleAccount[] {
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

  if (loginEnabled && !accounts.some((account) => account.enabled)) {
    throw new Error('NO_ENABLED_LIFECYCLE_ACCOUNT');
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
  const enabled = typeof account.enabled === 'boolean' ? account.enabled : undefined;
  const expectedCustomerId = account.expectedCustomerId;
  if (!label || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || password.length < 8 || typeof enabled !== 'boolean'
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