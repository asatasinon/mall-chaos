import { jsonOk } from '@/lib/api-response';
import { getRunnerStatus, getRunnerControlState } from '@/lib/runtime-state';
import { loadRunnerConfigFromDb } from '@/lib/runner-config';

export async function GET() {
  const [status, control, config] = await Promise.all([
    getRunnerStatus(),
    getRunnerControlState(),
    loadRunnerConfigFromDb(),
  ]);

  return jsonOk(
    status ? {
      ...status,
      workerOnline: true,
      running: status.running && config.enabled && !control.paused,
      enabled: config.enabled,
      paused: control.paused,
      configVersion: config.version,
      lifecycleIntervalSec: config.lifecycleIntervalSec,
    } : {
      running: false,
      workerOnline: false,
      enabled: config.enabled,
      paused: control.paused,
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
      updatedAt: null,
    }
  );
}
