import { NextRequest } from 'next/server';
import pino from 'pino';
import { jsonError, jsonOk } from './api-response';
import { isCsrfRequest } from './csrf';
import { env } from './env';
import { getGatewayClient } from './gateway-client';
import { getScenarioDefinition } from './fault-run-catalog';
import {
  FaultRunCommandError,
  appendFaultRunEvent,
  hashFaultRunCommandIdempotencyKey,
  loadFaultRun,
  requestFaultRunManualCleanup,
  type FaultRunCommandResult,
  type FaultRunRecord,
  type RequestFaultRunManualCleanupInput,
} from './fault-run-repository';
import { getOperatorAuditOperatorId, recordOperatorAudit } from './operator-audit';
import { buildFaultRunOperatorRun } from './fault-run-operator-view';
import { getOrCreateTraceId } from './trace';

const log = pino({ name: 'fault-run-cleanup-route' });

export interface FaultRunCleanupRouteDependencies {
  safeRuntimeEnabled: () => boolean;
  requestManualCleanup: (
    input: RequestFaultRunManualCleanupInput,
  ) => Promise<FaultRunCommandResult | null>;
  loadRun: typeof loadFaultRun;
  legacyCleanup: (run: FaultRunRecord, traceId: string) => Promise<unknown>;
  appendEvent: typeof appendFaultRunEvent;
  recordAudit: typeof recordOperatorAudit;
  operatorId: typeof getOperatorAuditOperatorId;
  buildRun: (run: FaultRunRecord, options: { safeRuntimeEnabled: boolean }) => unknown;
  traceId: typeof getOrCreateTraceId;
}

const defaultDependencies: FaultRunCleanupRouteDependencies = {
  safeRuntimeEnabled: () => env.FAULT_RUN_SAFE_RUNTIME_ENABLED,
  requestManualCleanup: requestFaultRunManualCleanup,
  loadRun: loadFaultRun,
  legacyCleanup: (run, traceId) => getGatewayClient().postInternal(
    '/internal/gateway/operations/cleanup',
    {
      runId: run.faultRunId,
      operation: run.targetOperation,
      fencingToken: run.fencingToken,
    },
    traceId,
  ),
  appendEvent: appendFaultRunEvent,
  recordAudit: recordOperatorAudit,
  operatorId: getOperatorAuditOperatorId,
  buildRun: buildFaultRunOperatorRun,
  traceId: getOrCreateTraceId,
};

export function createFaultRunCleanupRouteHandler(
  dependencies: FaultRunCleanupRouteDependencies = defaultDependencies,
) {
  return async function handleFaultRunCleanup(
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
      confirmed = (await request.json())?.confirmed === true;
    } catch {
      // An empty body is not confirmed and is rejected below.
    }
    if (!confirmed) return jsonError(400, 'Confirmation is required', 400);

    const traceId = dependencies.traceId(request.headers);
    const safeRuntimeEnabled = dependencies.safeRuntimeEnabled();
    try {
      if (safeRuntimeEnabled) {
        const command = await dependencies.requestManualCleanup({
          faultRunId,
          requestKey: idempotencyKey,
          audit: {
            operatorId: dependencies.operatorId(request),
            correlationId: traceId,
          },
        });
        if (!command) return jsonError(404, 'Fault Run not found', 404);
        return jsonOk(
          dependencies.buildRun(command.run, { safeRuntimeEnabled }),
          command.disposition === 'ACCEPTED' ? 202 : 200,
        );
      }

      const run = await dependencies.loadRun(faultRunId);
      if (!run) return jsonError(404, 'Fault Run not found', 404);
      const definition = getScenarioDefinition(run.scenario);
      if (!definition.allowManualCleanup) return jsonError(403, 'Cleanup is not allowed for this scenario', 403);
      if (!['RECOVERED', 'STOPPED'].includes(run.state)) {
        return jsonError(409, 'Fault Run must be recovered before cleanup', 409);
      }
      const result = await dependencies.legacyCleanup(run, traceId);
      await dependencies.appendEvent(faultRunId, 'MANUAL_CLEANUP_COMPLETED', { result });
      await dependencies.recordAudit({
        request,
        action: 'FAULT_RUN_CLEANUP',
        target: run.scenario,
        parameters: { faultRunId, idempotencyKey },
        result: 'SUCCESS',
        correlationId: traceId,
      });
      return jsonOk({ faultRunId });
    } catch (error) {
      if (safeRuntimeEnabled) {
        if (error instanceof FaultRunCommandError) {
          if (error.code === 'CLEANUP_NOT_ALLOWED') {
            return jsonError(403, 'Cleanup is not allowed for this Fault Run', 403);
          }
          if (error.code === 'CLEANUP_STATE_INVALID'
            || error.code === 'CLEANUP_REQUEST_CONFLICT'
            || error.code === 'RECOVERY_STATE_INVALID') {
            return jsonError(409, 'Fault Run cleanup conflicts with its current recovery state', 409);
          }
          return jsonError(400, 'Fault Run cleanup request is invalid', 400);
        }
        try {
          await dependencies.recordAudit({
            request,
            action: 'FAULT_RUN_CLEANUP',
            parameters: {
              faultRunId,
              requestKeyHash: hashFaultRunCommandIdempotencyKey(idempotencyKey),
            },
            result: 'FAILURE',
            correlationId: traceId,
          });
        } catch {
          log.warn(
            { code: 'FAULT_RUN_CLEANUP_FAILURE_AUDIT_WRITE_FAILED' },
            'Failed to record Fault Run cleanup failure audit',
          );
        }
        return jsonError(502, 'Failed to accept Fault Run cleanup', 502);
      }
      const run = await dependencies.loadRun(faultRunId);
      if (run) {
        try {
          await dependencies.appendEvent(faultRunId, 'MANUAL_CLEANUP_FAILED', {
            targetService: run.targetService,
          });
        } catch {
          log.warn(
            { code: 'FAULT_RUN_CLEANUP_FAILURE_EVENT_WRITE_FAILED' },
            'Failed to record Fault Run cleanup failure event',
          );
        }
      }
      try {
        await dependencies.recordAudit({
          request,
          action: 'FAULT_RUN_CLEANUP',
          target: run?.scenario,
          parameters: { faultRunId, idempotencyKey },
          result: 'FAILURE',
          correlationId: traceId,
        });
      } catch {
        log.warn(
          { code: 'FAULT_RUN_CLEANUP_FAILURE_AUDIT_WRITE_FAILED' },
          'Failed to record Fault Run cleanup failure audit',
        );
      }
      return jsonError(502, 'Failed to clean Fault Run resources', 502);
    }
  };
}
