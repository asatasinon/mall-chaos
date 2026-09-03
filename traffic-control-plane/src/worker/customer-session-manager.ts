import {
  CustomerAuthResponse,
  CustomerRequestContext,
  CustomerSession,
  GatewayClient,
  GatewayRequestError,
  getGatewayClient,
} from '../lib/gateway-client';
import {
  LifecycleAccount,
  loadLifecycleAccountsWithState,
  validateLoginIdentity,
} from '../lib/lifecycle-accounts';
import type { FaultRunContext } from '../lib/fault-run-context';
import { loadScenarioAccounts } from '../lib/scenario-accounts';

interface ActiveSession {
  account: LifecycleAccount;
  session: CustomerSession;
}

export interface CustomerSessionManagerDependencies {
  accounts?: LifecycleAccount[];
  gateway?: GatewayClient;
  random?: () => number;
  allowScenarioAccounts?: boolean;
}

export interface SessionRunOptions {
  signal?: AbortSignal;
  faultRunContext?: FaultRunContext;
}

export class CustomerSessionManager {
  private readonly configuredAccounts: LifecycleAccount[] | null;
  private readonly gateway: GatewayClient;
  private readonly random: () => number;
  private readonly allowScenarioAccounts: boolean;
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(dependencies: CustomerSessionManagerDependencies = {}) {
    this.configuredAccounts = dependencies.accounts ?? null;
    this.gateway = dependencies.gateway ?? getGatewayClient();
    this.random = dependencies.random ?? Math.random;
    this.allowScenarioAccounts = dependencies.allowScenarioAccounts ?? false;
  }

  async openSession(
    trafficRunId: string,
    lifecycleId: string,
    traceId: string,
    runOptions: SessionRunOptions = {},
  ): Promise<CustomerRequestContext> {
    if (this.sessions.has(lifecycleId)) {
      throw new Error('LIFECYCLE_SESSION_ALREADY_EXISTS');
    }
    const account = await this.selectAccount();
    let auth: CustomerAuthResponse;
    try {
      auth = await this.gateway.login(account.email, account.password, traceId);
    } catch (error) {
      if (error instanceof GatewayRequestError && error.status === 401) {
        throw new Error('LIFECYCLE_LOGIN_INVALID_CREDENTIALS');
      }
      if (error instanceof GatewayRequestError && [502, 503, 504].includes(error.status)) {
        throw new Error('LIFECYCLE_LOGIN_GATEWAY_UNAVAILABLE');
      }
      throw new Error('LIFECYCLE_LOGIN_FAILED');
    }

    let customerId: number;
    try {
      customerId = validateLoginIdentity(account, auth);
    } catch (error) {
      throw error instanceof Error ? error : new Error('LIFECYCLE_LOGIN_IDENTITY_INVALID');
    }
    const expiresAt = new Date(auth.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error('LIFECYCLE_AUTH_RESPONSE_INVALID');
    }

    const session: CustomerSession = {
      accountLabel: account.label,
      customerId,
      accessToken: auth.accessToken,
      sessionToken: auth.sessionToken,
      expiresAt,
    };
    this.sessions.set(lifecycleId, { account, session });
    return this.contextFor(trafficRunId, lifecycleId, traceId, session, runOptions);
  }

  async refreshSession(lifecycleId: string, traceId: string): Promise<void> {
    const active = this.sessions.get(lifecycleId);
    if (!active) {
      throw new Error('LIFECYCLE_SESSION_NOT_FOUND');
    }
    if (!active.account.enabled) {
      throw new Error('LIFECYCLE_ACCOUNT_DISABLED');
    }

    let auth: CustomerAuthResponse;
    try {
      auth = await this.gateway.refresh(active.session.sessionToken, traceId);
    } catch {
      throw new Error('LIFECYCLE_SESSION_REFRESH_FAILED');
    }
    let customerId: number;
    try {
      customerId = validateLoginIdentity(active.account, auth);
    } catch {
      throw new Error('LIFECYCLE_SESSION_REFRESH_FAILED');
    }
    if (customerId !== active.session.customerId) {
      throw new Error('LIFECYCLE_CUSTOMER_ID_MISMATCH');
    }
    const expiresAt = new Date(auth.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error('LIFECYCLE_SESSION_REFRESH_FAILED');
    }
    active.session.accessToken = auth.accessToken;
    active.session.sessionToken = auth.sessionToken;
    active.session.expiresAt = expiresAt;
  }

  async closeSession(lifecycleId: string, traceId: string): Promise<void> {
    const active = this.sessions.get(lifecycleId);
    if (!active) return;
    try {
      await this.gateway.logout(active.session.sessionToken, traceId);
    } catch {
      // Logout is best effort; the local session must still be discarded.
    } finally {
      this.sessions.delete(lifecycleId);
      active.session.accessToken = '';
      active.session.sessionToken = '';
    }
  }

  hasSession(lifecycleId: string): boolean {
    return this.sessions.has(lifecycleId);
  }

  private async selectAccount(): Promise<LifecycleAccount> {
    const accounts = this.configuredAccounts ?? await loadLifecycleAccountsWithState();
    const scenarioEmails = this.allowScenarioAccounts
      ? new Set<string>()
      : new Set(loadScenarioAccounts().map((account) => account.email));
    const enabled = accounts.filter((account) => account.enabled
      && (this.allowScenarioAccounts
        || (account.expectedCustomerId !== 19 && !scenarioEmails.has(account.email))));
    if (enabled.length === 0) {
      throw new Error('LIFECYCLE_NO_ENABLED_ACCOUNT');
    }
    return enabled[Math.floor(this.random() * enabled.length)];
  }

  private contextFor(
    trafficRunId: string,
    lifecycleId: string,
    traceId: string,
    session: CustomerSession,
    runOptions: SessionRunOptions = {},
  ): CustomerRequestContext {
    return {
      trafficRunId,
      lifecycleId,
      traceId,
      session,
      refresh: () => this.refreshSession(lifecycleId, traceId),
      ...runOptions,
    };
  }
}
