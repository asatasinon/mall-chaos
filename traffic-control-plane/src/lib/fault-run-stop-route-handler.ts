import { NextRequest } from 'next/server';
import pino from 'pino';
import { jsonError, jsonOk } from './api-response';
import { isCsrfRequest } from './csrf';
import { env } from './env';
import { getLegacyFaultRunRecovery } from './legacy-fault-run-recovery';
import {
  FaultRunCommandError,
  hashFaultRunCommandIdempotencyKey,
  requestFaultRunStop,
  attachOperatorAudit,
  type FaultRunCommandResult,
  type FaultRunRecord,
  type RequestFaultRunStopInput,
} from './fault-run-repository';
import { getOperatorAuditOperatorId, recordOperatorAudit } from './operator-audit';
import { buildFaultRunOperatorRun } from './fault-run-operator-view';
import { getOrCreateTraceId } from './trace';

const log = pino({ name: 'fault-run-stop-route' });

export interface FaultRunStopRouteDependencies {
  safeRuntimeEnabled: () => boolean;
  requestStop: (input: RequestFaultRunStopInput) => Promise<FaultRunCommandResult | null>;
  legacyStop: (faultRunId: string) => Promise<FaultRunRecord | null>;
  recordAudit: typeof recordOperatorAudit;
  attachAudit: typeof attachOperatorAudit;
  operatorId: typeof getOperatorAuditOperatorId;
  buildRun: (run: FaultRunRecord, options: { safeRuntimeEnabled: boolean }) => unknown;
  traceId: typeof getOrCreateTraceId;
}

const defaultDependencies: FaultRunStopRouteDependencies = {
  safeRuntimeEnabled: () => env.FAULT_RUN_SAFE_RUNTIME_ENABLED,
  requestStop: requestFaultRunStop,
  legacyStop: (faultRunId) => getLegacyFaultRunRecovery().stop(faultRunId),
  recordAudit: recordOperatorAudit,
  attachAudit: attachOperatorAudit,
  operatorId: getOperatorAuditOperatorId,
  buildRun: buildFaultRunOperatorRun,
  traceId: getOrCreateTraceId,
};

export function createFaultRunStopRouteHandler(
  dependencies: FaultRunStopRouteDependencies = defaultDependencies,
) {
  return async function handleFaultRunStop(
    request: NextRequest,
    context: { params: Promise<{ faultRunId: string }> },
  ) {
    if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
    const { faultRunId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(faultRunId)) return jsonError(400, 'Invalid faultRunId', 400);
    const idempotencyKey = request.headers.get('X-Idempotency-Key');
    if (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
      return jsonError(400, 'A valid idempotency key is required', 400);
    }
    let confirmed = false;
    try {
      const body = await request.json();
      confirmed = body?.confirmed === true;
    } catch {
      // An empty body is not confirmed and is rejected below.
    }
    if (!confirmed) return jsonError(400, 'Confirmation is required', 400);

    const traceId = dependencies.traceId(request.headers);
    const safeRuntimeEnabled = dependencies.safeRuntimeEnabled();
    try {
      if (safeRuntimeEnabled) {
        const result = await dependencies.requestStop({
          faultRunId,
          reason: 'MANUAL',
          requestKey: idempotencyKey,
          drainTimeoutMs: env.FAULT_RUN_DRAIN_TIMEOUT_MS,
          recoveryTimeoutMs: env.FAULT_RUN_RECOVERY_TIMEOUT_MS,
          audit: {
            operatorId: dependencies.operatorId(request),
            correlationId: traceId,
          },
        });
        if (!result) return jsonError(404, 'Fault Run not found', 404);
        return jsonOk(
          dependencies.buildRun(result.run, { safeRuntimeEnabled }),
          result.disposition === 'ACCEPTED' ? 202 : 200,
        );
      }

      const run = await dependencies.legacyStop(faultRunId);
      if (!run) return jsonError(404, 'Fault Run not found', 404);
      const auditId = await dependencies.recordAudit({
        request,
        action: 'FAULT_RUN_STOP',
        target: run.scenario,
        parameters: { faultRunId, idempotencyKey },
        result: 'SUCCESS',
        correlationId: traceId,
      });
      await dependencies.attachAudit(faultRunId, auditId);
      return jsonOk(dependencies.buildRun(run, { safeRuntimeEnabled }));
    } catch (error) {
      if (error instanceof FaultRunCommandError
        && (error.code === 'STOP_REQUEST_CONFLICT' || error.code === 'RECOVERY_STATE_INVALID')) {
        return jsonError(409, 'Fault Run stop request conflicts with its current recovery state', 409);
      }
      try {
        await dependencies.recordAudit({
          request,
          action: 'FAULT_RUN_STOP',
          parameters: {
            faultRunId,
            requestKeyHash: safeRuntimeEnabled
              ? hashFaultRunCommandIdempotencyKey(idempotencyKey)
              : idempotencyKey,
          },
          result: 'FAILURE',
          correlationId: traceId,
        });
      } catch {
        log.warn(
          { code: 'FAULT_RUN_STOP_FAILURE_AUDIT_WRITE_FAILED' },
          'Failed to record Fault Run stop failure audit',
        );
      }
      return jsonError(502, 'Failed to stop Fault Run', 502);
    }
  };
}
