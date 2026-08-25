import { getGatewayClient } from '@/lib/gateway-client';
import { getOrCreateTraceId } from '@/lib/trace';
import { jsonOk } from '@/lib/api-response';
import { getRunnerStatus } from '@/lib/runtime-state';
import { loadRunnerConfigFromDb } from '@/lib/runner-config';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const traceId = getOrCreateTraceId(request.headers);
  const gateway = getGatewayClient();
  const [runnerStatus, config] = await Promise.all([
    getRunnerStatus(),
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

  await Promise.allSettled(
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
        enabled: config.enabled,
        paused: false,
        trafficMode: config.trafficMode,
        lifecycleIntervalSec: config.lifecycleIntervalSec,
        configVersion: config.version,
        trafficRunId: null,
        currentLifecycleId: null,
        lastLifecycleStartedAt: null,
        lastLifecycleCompletedAt: null,
        lifecycleStartedCount: 0,
        lifecycleCompletedCount: 0,
        lifecycleNoopCount: 0,
        lifecycleFailedCount: 0,
        lifecycleInterruptedCount: 0,
        averageIntervalSec: null,
        paymentSuccessCount: 0,
        cancelCount: 0,
        couponRequestedCount: 0,
        couponAppliedCount: 0,
        addressCreatedCount: 0,
        cartReusedCount: 0,
        pendingPaymentRetainedCount: 0,
        faultScenarioCount: 0,
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
