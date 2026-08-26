import { env } from './env';
import { withTrace } from './trace';

/**
 * Gateway client — all outbound HTTP from traffic-control-plane goes through gateway.
 */
export class GatewayRequestError extends Error {
  constructor(
    method: string,
    path: string,
    public readonly status: number,
    internal = false,
  ) {
    super(`Gateway ${internal ? 'internal ' : ''}${method} ${path} failed (${status})`);
    this.name = 'GatewayRequestError';
  }
}

export class GatewayClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || env.GATEWAY_BASE_URL).replace(/\/$/, '');
  }

  async post<T = unknown>(
    path: string,
    body: unknown,
    options?: string | GatewayRequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestOptions = normalizeOptions(options);
    const res = await fetch(url, withTrace({
      method: 'POST',
      headers: this.headers('application/json'),
      body: JSON.stringify(body),
    }, requestOptions.traceId));
    if (!res.ok) {
      throw new GatewayRequestError('POST', path, res.status);
    }
    return res.json();
  }

  async postInternal<T = unknown>(path: string, body: unknown, traceId?: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, withTrace({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': env.CASTREL_INTERNAL_SERVICE_KEY,
      },
      body: JSON.stringify(body),
    }, traceId));
    if (!res.ok) {
      throw new GatewayRequestError('POST', path, res.status, true);
    }
    return res.json();
  }

  async login(email: string, password: string, traceId?: string): Promise<CustomerAuthResponse> {
    return this.authRequest('/api/auth/login', { email, password }, undefined, traceId);
  }

  async refresh(sessionToken: string, traceId?: string): Promise<CustomerAuthResponse> {
    return this.authRequest('/api/auth/refresh', undefined, sessionToken, traceId);
  }

  async logout(sessionToken: string, traceId?: string): Promise<void> {
    await this.request('/api/auth/logout', 'POST', undefined, {
      'X-Session-Token': sessionToken,
    }, traceId);
  }

  async customerGet<T = unknown>(
    path: string,
    params: Record<string, string> | undefined,
    context: CustomerRequestContext,
  ): Promise<T> {
    return this.customerRequest<T>('GET', path, params, context);
  }

  async customerPost<T = unknown>(
    path: string,
    body: unknown,
    context: CustomerRequestContext,
  ): Promise<T> {
    return this.customerRequest<T>('POST', path, body, context);
  }

  async customerPatch<T = unknown>(
    path: string,
    body: unknown,
    context: CustomerRequestContext,
  ): Promise<T> {
    return this.customerRequest<T>('PATCH', path, body, context);
  }

  async customerDelete<T = unknown>(path: string, context: CustomerRequestContext): Promise<T> {
    return this.customerRequest<T>('DELETE', path, undefined, context);
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string>,
    options?: string | GatewayRequestOptions,
  ): Promise<T> {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const url = `${this.baseUrl}${path}${qs}`;
    const requestOptions = normalizeOptions(options);
    const res = await fetch(url, withTrace({
      method: 'GET',
      headers: this.headers(undefined),
    }, requestOptions.traceId));
    if (!res.ok) {
      throw new GatewayRequestError('GET', path, res.status);
    }
    return res.json();
  }

  async patch<T = unknown>(
    path: string,
    body: unknown,
    options?: string | GatewayRequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestOptions = normalizeOptions(options);
    const res = await fetch(url, withTrace({
      method: 'PATCH',
      headers: this.headers('application/json'),
      body: JSON.stringify(body),
    }, requestOptions.traceId));
    if (!res.ok) {
      throw new GatewayRequestError('PATCH', path, res.status);
    }
    return res.json();
  }

  async delete<T = unknown>(path: string, options?: string | GatewayRequestOptions): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestOptions = normalizeOptions(options);
    const res = await fetch(url, withTrace({
      method: 'DELETE',
      headers: this.headers(undefined),
    }, requestOptions.traceId));
    if (!res.ok) {
      throw new GatewayRequestError('DELETE', path, res.status);
    }
    return res.json();
  }

  private headers(contentType?: string): Record<string, string> {
    return {
      ...(contentType ? { 'Content-Type': contentType } : {}),
    };
  }

  private async authRequest(
    path: string,
    body: unknown,
    sessionToken: string | undefined,
    traceId?: string,
  ): Promise<CustomerAuthResponse> {
    const response = await this.request<ApiEnvelope<CustomerAuthResponse>>(
      path,
      'POST',
      body,
      sessionToken ? { 'X-Session-Token': sessionToken } : undefined,
      traceId,
    );
    if (!response?.data || !Number.isInteger(response.data.userId)
        || typeof response.data.accessToken !== 'string'
        || typeof response.data.sessionToken !== 'string') {
      throw new Error('CUSTOMER_AUTH_RESPONSE_INVALID');
    }
    return response.data;
  }

  private async customerRequest<T>(
    method: CustomerHttpMethod,
    path: string,
    payload: unknown,
    context: CustomerRequestContext,
  ): Promise<T> {
    let refreshed = false;
    if (shouldRefresh(context.session.expiresAt, Date.now())) {
      await this.refreshCustomerSession(context);
      refreshed = true;
    }

    let response = await this.rawCustomerRequest<T>(method, path, payload, context);
    if (response.response.status === 401 && !refreshed) {
      await this.refreshCustomerSession(context);
      response = await this.rawCustomerRequest<T>(method, path, payload, context);
    }
    if (!response.response.ok) {
      throw new Error(`Gateway customer ${method} ${path} failed (${response.response.status})`);
    }
    return response.body as T;
  }

  private async rawCustomerRequest<T>(
    method: CustomerHttpMethod,
    path: string,
    payload: unknown,
    context: CustomerRequestContext,
  ): Promise<{ response: Response; body?: T }> {
    const isGet = method === 'GET';
    const qs = isGet && payload ? '?' + new URLSearchParams(payload as Record<string, string>).toString() : '';
    const response = await fetch(`${this.baseUrl}${path}${qs}`, withTrace({
      method,
      headers: {
        ...(isGet ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${context.session.accessToken}`,
      },
      ...(!isGet && payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    }, context.traceId));
    if (!response.ok) return { response };
    return { response, body: await response.json() as T };
  }

  private async refreshCustomerSession(context: CustomerRequestContext): Promise<void> {
    try {
      await context.refresh();
    } catch {
      throw new Error('CUSTOMER_SESSION_REFRESH_FAILED');
    }
  }

  private async request<T = unknown>(
    path: string,
    method: CustomerHttpMethod,
    body?: unknown,
    extraHeaders?: Record<string, string>,
    traceId?: string,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, withTrace({
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(extraHeaders ?? {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, traceId));
    if (!response.ok) {
      throw new GatewayRequestError(method, path, response.status);
    }
    return response.json();
  }
}

type CustomerHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface CustomerAuthResponse {
  userId: number;
  accessToken: string;
  sessionToken: string;
  expiresAt: string;
  roles: string[];
}

export interface CustomerSession {
  accountLabel: string;
  customerId: number;
  accessToken: string;
  sessionToken: string;
  expiresAt: Date;
}

export interface CustomerRequestContext {
  trafficRunId: string;
  lifecycleId: string;
  traceId: string;
  session: CustomerSession;
  refresh: () => Promise<void>;
}

interface ApiEnvelope<T> {
  data?: T;
}

function shouldRefresh(expiresAt: Date, now: number): boolean {
  return expiresAt.getTime() - now <= 60_000;
}

export interface GatewayRequestOptions {
  traceId?: string;
}

function normalizeOptions(
  options?: string | GatewayRequestOptions,
): GatewayRequestOptions {
  if (typeof options === 'string') return { traceId: options };
  return options ?? {};
}

// Singleton for shared use
let gatewayClient: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!gatewayClient) {
    gatewayClient = new GatewayClient();
  }
  return gatewayClient;
}
