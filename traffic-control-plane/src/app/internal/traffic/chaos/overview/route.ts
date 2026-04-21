import { getGatewayClient } from '@/lib/gateway-client';
import { getOrCreateTraceId } from '@/lib/trace';
import { jsonOk } from '@/lib/api-response';
import { getRunnerStatus, getRunnerControlState } from '@/lib/runtime-state';
import { loadRunnerConfigFromDb } from '@/lib/runner-config';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const traceId = getOrCreateTraceId(request.headers);
  const gateway = getGatewayClient();
  const [runnerStatus, controlState, config] = await Promise.all([
    getRunnerStatus(),
    getRunnerControlState(),
    loadRunnerConfigFromDb(),
  ]);

  const chaosTypes = [
    { key: 'slowSql', path: '/internal/gateway/chaos/slow-sql/status' },
    { key: 'memoryLeak', path: '/internal/gateway/chaos/memory-leak/status' },
    { key: 'deadlock', path: '/internal/gateway/chaos/deadlock/status' },
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
    runner:
      runnerStatus ?? {
        running: false,
        paused: controlState.paused,
        currentQps: 0,
        successRate: 0,
        failRate: 0,
        totalRequests: 0,
        windowSeconds: 60,
        rateMultiplier: controlState.rateMultiplier,
        configVersion: config.version,
        updatedAt: null,
      },
    chaos: {
      ...chaosStatus,
      tableLock: {
        active: false,
        message: 'status is target-specific; query with targetService and targetTable',
      },
    },
    timestamp: new Date().toISOString(),
  });
}
