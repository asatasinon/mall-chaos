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
  loginSignals: Array<AbortSignal | undefined>;
  refreshSignals: Array<AbortSignal | undefined>;
  logoutSignals: Array<AbortSignal | undefined>;
} {
  const gateway = {
    loginCalls: [],
    refreshCalls: [],
    logoutCalls: [],
    loginSignals: [],
    refreshSignals: [],
    logoutSignals: [],
    async login(
      email: string,
      _password?: string,
      _traceId?: string,
      signal?: AbortSignal,
    ): Promise<CustomerAuthResponse> {
      gateway.loginCalls.push(email);
      gateway.loginSignals.push(signal);
      return auth();
    },
    async refresh(
      sessionToken: string,
      _traceId?: string,
      signal?: AbortSignal,
    ): Promise<CustomerAuthResponse> {
      gateway.refreshCalls.push(sessionToken);
      gateway.refreshSignals.push(signal);
      return auth();
    },
    async logout(sessionToken: string, _traceId?: string, signal?: AbortSignal): Promise<void> {
      gateway.logoutCalls.push(sessionToken);
      gateway.logoutSignals.push(signal);
    },
    ...overrides,
  } as unknown as GatewayClient & {
    loginCalls: string[];
    refreshCalls: string[];
    logoutCalls: string[];
    loginSignals: Array<AbortSignal | undefined>;
    refreshSignals: Array<AbortSignal | undefined>;
    logoutSignals: Array<AbortSignal | undefined>;
  };
  return gateway;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
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

test('allows the configured scenario account when explicitly enabled', async () => {
  const gateway = fakeGateway({
    async login(): Promise<CustomerAuthResponse> {
      return auth(19);
    },
  });
  const manager = new CustomerSessionManager({
    accounts: [{
      label: 'sam',
      email: 'sam@example.com',
      password: 'password',
      expectedCustomerId: 19,
      enabled: true,
    }],
    gateway,
    allowScenarioAccounts: true,
  });

  const context = await manager.openSession('run-1', 'scenario-1', 'trace-1');

  assert.equal(context.session.accountLabel, 'sam');
  assert.equal(context.session.customerId, 19);
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

test('forwards a Run cancellation signal to login and does not retain a late login response', async () => {
  const login = deferred<CustomerAuthResponse>();
  let loginSignal: AbortSignal | undefined;
  const gateway = fakeGateway({
    async login(
      _email: string,
      _password: string,
      _traceId?: string,
      signal?: AbortSignal,
    ): Promise<CustomerAuthResponse> {
      loginSignal = signal;
      return login.promise;
    },
  });
  const manager = new CustomerSessionManager({ accounts, gateway, random: () => 0 });
  const controller = new AbortController();

  const opening = manager.openSession('run-1', 'lifecycle-1', 'trace-1', { signal: controller.signal });
  await Promise.resolve();
  assert.equal(loginSignal, controller.signal);

  controller.abort();
  login.resolve(auth());
  await assert.rejects(
    opening,
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  assert.equal(manager.hasSession('lifecycle-1'), false);
});

test('does not rewrite a cancelled refresh as a normal session refresh failure', async () => {
  const refresh = deferred<CustomerAuthResponse>();
  let refreshSignal: AbortSignal | undefined;
  const gateway = fakeGateway({
    async refresh(
      _sessionToken: string,
      _traceId?: string,
      signal?: AbortSignal,
    ): Promise<CustomerAuthResponse> {
      refreshSignal = signal;
      return refresh.promise;
    },
  });
  const manager = new CustomerSessionManager({ accounts, gateway, random: () => 0 });
  const context = await manager.openSession('run-1', 'lifecycle-1', 'trace-1');
  const controller = new AbortController();

  const refreshing = manager.refreshSession('lifecycle-1', 'trace-refresh', controller.signal);
  await Promise.resolve();
  assert.equal(refreshSignal, controller.signal);
  controller.abort();
  refresh.resolve(auth());

  await assert.rejects(
    refreshing,
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  assert.equal(context.session.accessToken, 'access-token');
  assert.equal(context.session.sessionToken, 'session-token');
});

test('clears local credentials before a cancelled logout can settle', async () => {
  const logout = deferred<void>();
  let logoutSignal: AbortSignal | undefined;
  const gateway = fakeGateway({
    async logout(
      _sessionToken: string,
      _traceId?: string,
      signal?: AbortSignal,
    ): Promise<void> {
      logoutSignal = signal;
      return logout.promise;
    },
  });
  const manager = new CustomerSessionManager({ accounts, gateway, random: () => 0 });
  const context = await manager.openSession('run-1', 'lifecycle-1', 'trace-1');
  const controller = new AbortController();
  controller.abort();

  const closing = manager.closeSession('lifecycle-1', 'trace-logout', controller.signal);
  assert.equal(logoutSignal, controller.signal);
  assert.equal(manager.hasSession('lifecycle-1'), false);
  assert.equal(context.session.accessToken, '');
  assert.equal(context.session.sessionToken, '');

  logout.resolve();
  await closing;
  assert.equal(manager.hasSession('lifecycle-1'), false);
});

test('does not restore credentials when refresh races with local session closure', async () => {
  const refresh = deferred<CustomerAuthResponse>();
  const logout = deferred<void>();
  const gateway = fakeGateway({
    async refresh(): Promise<CustomerAuthResponse> {
      return refresh.promise;
    },
    async logout(): Promise<void> {
      return logout.promise;
    },
  });
  const manager = new CustomerSessionManager({ accounts, gateway, random: () => 0 });
  const context = await manager.openSession('run-1', 'lifecycle-1', 'trace-1');

  const refreshing = manager.refreshSession('lifecycle-1', 'trace-refresh');
  await Promise.resolve();
  const closing = manager.closeSession('lifecycle-1', 'trace-logout');
  assert.equal(manager.hasSession('lifecycle-1'), false);
  assert.equal(context.session.accessToken, '');
  assert.equal(context.session.sessionToken, '');

  refresh.resolve(auth());
  await assert.rejects(refreshing, /LIFECYCLE_SESSION_NOT_FOUND/);
  assert.equal(context.session.accessToken, '');
  assert.equal(context.session.sessionToken, '');
  logout.resolve();
  await closing;
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
