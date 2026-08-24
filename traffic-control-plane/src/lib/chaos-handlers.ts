import { getGatewayClient } from '@/lib/gateway-client';
import { jsonOk, jsonError } from '@/lib/api-response';
import { getOrCreateTraceId } from '@/lib/trace';
import { NextRequest } from 'next/server';
import { recordOperatorAudit } from '@/lib/operator-audit';

/**
 * Creates standard chaos control route handlers that proxy through gateway.
 */
function unwrapGateway(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result;
  const r = result as Record<string, unknown>;
  return ('code' in r && 'data' in r) ? r.data : result;
}

export function createChaosHandlers(chaosType: string, gatewayPrefix: string) {
  return {
    enable: async (request: NextRequest) => {
      const body = await request.json();
      const traceId = getOrCreateTraceId(request.headers);
      const gateway = getGatewayClient();
      try {
        const result = await gateway.post(`${gatewayPrefix}/enable`, body, traceId);
        await recordOperatorAudit({ request, action: 'CHAOS_ENABLE', target: chaosType, parameters: body, result: 'SUCCESS', correlationId: traceId });
        return jsonOk(unwrapGateway(result));
      } catch (e: unknown) {
        await recordOperatorAudit({ request, action: 'CHAOS_ENABLE', target: chaosType, parameters: body, result: 'FAILURE', correlationId: traceId });
        return jsonError(502, `Failed to enable ${chaosType}: ${e instanceof Error ? e.message : String(e)}`, 502);
      }
    },

    disable: async (request: NextRequest) => {
      const body = await request.json().catch(() => ({}));
      const traceId = getOrCreateTraceId(request.headers);
      const gateway = getGatewayClient();
      try {
        const result = await gateway.post(`${gatewayPrefix}/disable`, body, traceId);
        await recordOperatorAudit({ request, action: 'CHAOS_DISABLE', target: chaosType, parameters: body, result: 'SUCCESS', correlationId: traceId });
        return jsonOk(unwrapGateway(result));
      } catch (e: unknown) {
        await recordOperatorAudit({ request, action: 'CHAOS_DISABLE', target: chaosType, parameters: body, result: 'FAILURE', correlationId: traceId });
        return jsonError(502, `Failed to disable ${chaosType}: ${e instanceof Error ? e.message : String(e)}`, 502);
      }
    },

    cleanup: async (request: NextRequest) => {
      const body = await request.json().catch(() => ({}));
      const traceId = getOrCreateTraceId(request.headers);
      const gateway = getGatewayClient();
      try {
        const result = await gateway.post(`${gatewayPrefix}/cleanup`, body, traceId);
        await recordOperatorAudit({ request, action: 'CHAOS_CLEANUP', target: chaosType, parameters: body, result: 'SUCCESS', correlationId: traceId });
        return jsonOk(unwrapGateway(result));
      } catch (e: unknown) {
        await recordOperatorAudit({ request, action: 'CHAOS_CLEANUP', target: chaosType, parameters: body, result: 'FAILURE', correlationId: traceId });
        return jsonError(502, `Failed to cleanup ${chaosType}: ${e instanceof Error ? e.message : String(e)}`, 502);
      }
    },

    status: async (request: NextRequest) => {
      const traceId = getOrCreateTraceId(request.headers);
      const params: Record<string, string> = {};
      request.nextUrl.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      const gateway = getGatewayClient();
      try {
        const result = await gateway.get(`${gatewayPrefix}/status`, params, traceId);
        return jsonOk(unwrapGateway(result));
      } catch (e: unknown) {
        return jsonError(502, `Failed to get ${chaosType} status: ${e instanceof Error ? e.message : String(e)}`, 502);
      }
    },
  };
}
