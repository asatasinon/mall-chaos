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
    status ?? {
      running: false,
      paused: control.paused,
      currentQps: 0,
      successRate: 0,
      failRate: 0,
      totalRequests: 0,
      windowSeconds: 60,
      rateMultiplier: control.rateMultiplier,
      configVersion: config.version,
      updatedAt: null,
    }
  );
}
