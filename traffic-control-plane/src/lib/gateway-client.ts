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

  async post<T = unknown>(path: string, body: unknown, traceId?: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, withTrace({
      method: 'POST',
      headers: this.headers('application/json'),
      body: JSON.stringify(body),
    }, traceId));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway POST ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async get<T = unknown>(path: string, params?: Record<string, string>, traceId?: string): Promise<T> {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const url = `${this.baseUrl}${path}${qs}`;
    const res = await fetch(url, withTrace({ method: 'GET', headers: this.headers() }, traceId));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway GET ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async delete<T = unknown>(path: string, traceId?: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, withTrace({ method: 'DELETE', headers: this.headers() }, traceId));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway DELETE ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  private headers(contentType?: string): Record<string, string> {
    return {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(env.TRAFFIC_RUNNER_CREDENTIAL
        ? { 'X-Traffic-Runner-Credential': env.TRAFFIC_RUNNER_CREDENTIAL }
        : {}),
    };
  }
}

// Singleton for shared use
let gatewayClient: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!gatewayClient) {
    gatewayClient = new GatewayClient();
  }
  return gatewayClient;
}
