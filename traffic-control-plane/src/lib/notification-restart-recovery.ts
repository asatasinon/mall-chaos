import { parseFaultRunRecoveryProjection } from './fault-run-recovery';
import type { FaultRunRecord } from './fault-run-repository';

export function isSafeRuntimeUnavailableHeapRun(run: FaultRunRecord): boolean {
  if (run.scenario !== 'NOTIFICATION_HEAP_PRESSURE' || run.state !== 'RECOVERING') return false;
  const recovery = parseFaultRunRecoveryProjection(run.recoveryResult);
  return recovery.kind === 'SAFE_RUNTIME_V1'
    && recovery.projection.outcome === 'SERVICE_UNAVAILABLE'
    && recovery.projection.residuals.some((residual) => residual.kind === 'SERVICE_RECOVERY_REQUIRED');
}
