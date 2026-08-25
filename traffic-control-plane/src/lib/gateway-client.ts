import { env } from './env';
import { withTrace } from './trace';

/**
 * Gateway client — all outbound HTTP from traffic-control-plane goes through gateway.
 */
export class GatewayClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || env.GATEWAY_BASE_URL).replace(/\/$/, '');
  }

  async post<T = unknown>(
    path: string,
    body: unknown,
    options?: string | GatewayRequestOptions | RunnerRequestContext,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestOptions = normalizeOptions(options);
    const res = await fetch(url, withTrace({
      method: 'POST',
      headers: this.headers('application/json', requestOptions.runner),
      body: JSON.stringify(body),
    }, requestOptions.traceId));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway POST ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string>,
    options?: string | GatewayRequestOptions | RunnerRequestContext,
  ): Promise<T> {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const url = `${this.baseUrl}${path}${qs}`;
    const requestOptions = normalizeOptions(options);
    const res = await fetch(url, withTrace({
      method: 'GET',
      headers: this.headers(undefined, requestOptions.runner),
    }, requestOptions.traceId));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway GET ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async patch<T = unknown>(
    path: string,
    body: unknown,
    options?: string | GatewayRequestOptions | RunnerRequestContext,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestOptions = normalizeOptions(options);
    const res = await fetch(url, withTrace({
      method: 'PATCH',
      headers: this.headers('application/json', requestOptions.runner),
      body: JSON.stringify(body),
    }, requestOptions.traceId));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway PATCH ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async delete<T = unknown>(path: string, options?: string | GatewayRequestOptions | RunnerRequestContext): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestOptions = normalizeOptions(options);
    const res = await fetch(url, withTrace({
      method: 'DELETE',
      headers: this.headers(undefined, requestOptions.runner),
    }, requestOptions.traceId));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway DELETE ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  private headers(contentType?: string, runner?: RunnerRequestContext): Record<string, string> {
    return {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(env.TRAFFIC_RUNNER_CREDENTIAL
        ? { 'X-Traffic-Runner-Credential': env.TRAFFIC_RUNNER_CREDENTIAL }
        : {}),
      ...(runner ? {
        'X-Traffic-Runner-Customer-Id': String(runner.customerId),
        'X-Traffic-Run-Id': runner.trafficRunId,
        'X-Traffic-Runner-Action': runner.action,
      } : {}),
    };
  }
}

export interface RunnerRequestContext {
  customerId: number;
  trafficRunId: string;
  action: string;
  traceId: string;
}

export interface GatewayRequestOptions {
  traceId?: string;
  runner?: RunnerRequestContext;
}

function normalizeOptions(
  options?: string | GatewayRequestOptions | RunnerRequestContext,
): GatewayRequestOptions {
  if (typeof options === 'string') return { traceId: options };
  if (options && 'customerId' in options) return { runner: options, traceId: options.traceId };
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
