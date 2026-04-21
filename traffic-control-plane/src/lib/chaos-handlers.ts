import { getGatewayClient } from '@/lib/gateway-client';
import { jsonOk, jsonError } from '@/lib/api-response';
import { getOrCreateTraceId } from '@/lib/trace';
import { NextRequest } from 'next/server';

/**
 * Creates standard chaos control route handlers that proxy through gateway.
 */
export function createChaosHandlers(chaosType: string, gatewayPrefix: string) {
  return {
    enable: async (request: NextRequest) => {
      const body = await request.json();
      const traceId = getOrCreateTraceId(request.headers);
      const gateway = getGatewayClient();
      try {
        const result = await gateway.post(`${gatewayPrefix}/enable`, body, traceId);
        return jsonOk(result);
      } catch (e: any) {
        return jsonError(502, `Failed to enable ${chaosType}: ${e.message}`, 502);
      }
    },

    disable: async (request: NextRequest) => {
      const body = await request.json().catch(() => ({}));
      const traceId = getOrCreateTraceId(request.headers);
      const gateway = getGatewayClient();
      try {
        const result = await gateway.post(`${gatewayPrefix}/disable`, body, traceId);
        return jsonOk(result);
      } catch (e: any) {
        return jsonError(502, `Failed to disable ${chaosType}: ${e.message}`, 502);
      }
    },

    cleanup: async (request: NextRequest) => {
      const body = await request.json().catch(() => ({}));
      const traceId = getOrCreateTraceId(request.headers);
      const gateway = getGatewayClient();
      try {
        const result = await gateway.post(`${gatewayPrefix}/cleanup`, body, traceId);
        return jsonOk(result);
      } catch (e: any) {
        return jsonError(502, `Failed to cleanup ${chaosType}: ${e.message}`, 502);
      }
    },

    status: async (request: NextRequest) => {
      const traceId = getOrCreateTraceId(request.headers);
      const targets = request.nextUrl.searchParams.get('targets');
      const params: Record<string, string> = {};
      if (targets) params.targets = targets;

      const gateway = getGatewayClient();
      try {
        const result = await gateway.get(`${gatewayPrefix}/status`, params, traceId);
        return jsonOk(result);
      } catch (e: any) {
        return jsonError(502, `Failed to get ${chaosType} status: ${e.message}`, 502);
      }
    },
  };
}
