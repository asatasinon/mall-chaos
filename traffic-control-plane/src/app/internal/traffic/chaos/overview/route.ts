import { getRunnerEngine } from '@/worker/runner-engine';
import { getGatewayClient } from '@/lib/gateway-client';
import { getOrCreateTraceId } from '@/lib/trace';
import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const traceId = getOrCreateTraceId(request.headers);
  const gateway = getGatewayClient();
  const engine = getRunnerEngine();

  const chaosTypes = [
    { key: 'slowSql', path: '/internal/gateway/chaos/slow-sql/status' },
    { key: 'memoryLeak', path: '/internal/gateway/chaos/memory-leak/status' },
    { key: 'deadlock', path: '/internal/gateway/chaos/deadlock/status' },
    { key: 'tableLock', path: '/internal/gateway/chaos/table-lock/status' },
    { key: 'networkDelay', path: '/internal/gateway/network-delay/status' },
    { key: 'networkReset', path: '/internal/gateway/network-reset/status' },
  ];

  const chaosStatus: Record<string, unknown> = {};

  const results = await Promise.allSettled(
    chaosTypes.map(async ({ key, path }) => {
      try {
        const data = await gateway.get(path, undefined, traceId);
        chaosStatus[key] = data;
      } catch {
        chaosStatus[key] = { error: 'unavailable' };
      }
    })
  );

  return jsonOk({
    runner: engine.getStatus(),
    chaos: chaosStatus,
    timestamp: new Date().toISOString(),
  });
}
