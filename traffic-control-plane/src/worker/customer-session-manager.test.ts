import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRequestError } from '../lib/gateway-client';
import type { CustomerAuthResponse, GatewayClient } from '../lib/gateway-client';
import type { LifecycleAccount } from '../lib/lifecycle-accounts';
import { CustomerSessionManager } from './customer-session-manager';

const accounts: LifecycleAccount[] = [
  {
    label: 'disabled',
    email: 'disabled@example.com',
    password: 'disabled-password',
    expectedCustomerId: 1,
    enabled: false,
  },
  {
    label: 'alice',
    email: 'alice@example.com',
    password: 'alice-password',
    expectedCustomerId: 2,
    enabled: true,
  },
];

function auth(userId = 2): CustomerAuthResponse {
  return {
    userId,
    accessToken: 'access-token',
    sessionToken: 'session-token',
    expiresAt: '2026-08-25T02:00:00.000Z',
    roles: ['CUSTOMER'],
  };
}

function fakeGateway(overrides: Partial<GatewayClient> = {}): GatewayClient & {
  loginCalls: string[];
  refreshCalls: string[];
  logoutCalls: string[];
} {
  const gateway = {
    loginCalls: [],
    refreshCalls: [],
    logoutCalls: [],
    async login(email: string): Promise<CustomerAuthResponse> {
      gateway.loginCalls.push(email);
      return auth();
    },
    async refresh(sessionToken: string): Promise<CustomerAuthResponse> {
      gateway.refreshCalls.push(sessionToken);
      return auth();
    },
    async logout(sessionToken: string): Promise<void> {
      gateway.logoutCalls.push(sessionToken);
    },
    ...overrides,
  } as unknown as GatewayClient & { loginCalls: string[]; refreshCalls: string[]; logoutCalls: string[] };
  return gateway;
}

test('selects an enabled account and creates one lifecycle session', async () => {
  const gateway = fakeGateway();
  const manager = new CustomerSessionManager({
    accounts,
    gateway,
    random: () => 0,
  });

  const context = await manager.openSession('run-1', 'lifecycle-1', 'trace-1');

  assert.equal(gateway.loginCalls.length, 1);
  assert.equal(gateway.loginCalls[0], 'alice@example.com');
  assert.equal(context.session.accountLabel, 'alice');
  assert.equal(context.session.customerId, 2);
  assert.equal(manager.hasSession('lifecycle-1'), true);
  await assert.rejects(
    manager.openSession('run-1', 'lifecycle-1', 'trace-2'),
    /LIFECYCLE_SESSION_ALREADY_EXISTS/,
  );
  assert.equal(gateway.loginCalls.length, 1);
});

test('rejects an unexpected login customer id without retaining a session', async () => {
  const gateway = fakeGateway({
    async login(): Promise<CustomerAuthResponse> {
      return auth(99);
    },
  });
  const manager = new CustomerSessionManager({ accounts, gateway, random: () => 0 });

  await assert.rejects(
    manager.openSession('run-1', 'lifecycle-1', 'trace-1'),
    /LIFECYCLE_CUSTOMER_ID_MISMATCH/,
  );
  assert.equal(manager.hasSession('lifecycle-1'), false);
});

test('reports invalid login credentials without exposing the gateway response', async () => {
  const gateway = fakeGateway({
    async login(): Promise<CustomerAuthResponse> {
      throw new GatewayRequestError('POST', '/api/auth/login', 401);
    },
  });
  const manager = new CustomerSessionManager({ accounts, gateway, random: () => 0 });

  await assert.rejects(
    manager.openSession('run-1', 'lifecycle-1', 'trace-1'),
    /LIFECYCLE_LOGIN_INVALID_CREDENTIALS/,
  );
});

test('refreshes only the lifecycle session and keeps customer ownership', async () => {
  const gateway = fakeGateway();
  const manager = new CustomerSessionManager({ accounts, gateway, random: () => 0 });
  const context = await manager.openSession('run-1', 'lifecycle-1', 'trace-1');
  const oldSession = context.session;

  await manager.refreshSession('lifecycle-1', 'trace-refresh');

  assert.deepEqual(gateway.refreshCalls, ['session-token']);
  assert.equal(context.session, oldSession);
  assert.equal(context.session.customerId, 2);
});

test('refresh failures use a stable result and logout failure still clears session', async () => {
  const gateway = fakeGateway({
    async refresh(): Promise<CustomerAuthResponse> {
      throw new Error('invalid session token');
    },
    async logout(): Promise<void> {
      throw new Error('gateway unavailable');
    },
  });
  const manager = new CustomerSessionManager({ accounts, gateway, random: () => 0 });
  const context = await manager.openSession('run-1', 'lifecycle-1', 'trace-1');

  await assert.rejects(
    manager.refreshSession('lifecycle-1', 'trace-refresh'),
    /LIFECYCLE_SESSION_REFRESH_FAILED/,
  );
  await manager.closeSession('lifecycle-1', 'trace-logout');

  assert.equal(manager.hasSession('lifecycle-1'), false);
  assert.equal(context.session.accessToken, '');
  assert.equal(context.session.sessionToken, '');
});

test('fails with a stable error when no enabled account exists', async () => {
  const manager = new CustomerSessionManager({
    accounts: accounts.map((account) => ({ ...account, enabled: false })),
    gateway: fakeGateway(),
  });

  await assert.rejects(
    manager.openSession('run-1', 'lifecycle-1', 'trace-1'),
    /LIFECYCLE_NO_ENABLED_ACCOUNT/,
  );
});
