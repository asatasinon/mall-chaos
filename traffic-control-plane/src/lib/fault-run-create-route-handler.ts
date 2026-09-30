import type { NextRequest } from 'next/server';
import { jsonError, jsonOk } from './api-response';
import { isCsrfRequest } from './csrf';
import { env, type FaultRunReconciliationMode } from './env';
import {
  ActiveFaultRunError,
  attachOperatorAudit,
  IdempotencyKeyReuseError,
} from './fault-run-repository';
import { getScenarioDefinition, FaultRunValidationError, validateScenarioParameters } from './fault-run-catalog';
import { getFaultRunCoordinator, type CreateFaultRunCommand } from './fault-run-coordinator';
import { ScenarioContractAdmissionError, type ScenarioContractAdmissionConfig } from './scenario-contract-admission';
import { readScenarioContractWebConfig } from './scenario-contract-web-config';
import { recordOperatorAudit } from './operator-audit';
import {
  buildFaultRunOperatorAction,
  buildFaultRunOperatorRun,
} from './fault-run-operator-view';
import { getOrCreateTraceId } from './trace';
import { verifyFaultRunOwnershipSchema } from './fault-run-schema';

export interface FaultRunCreateRouteDependencies {
  safeRuntimeEnabled: () => boolean;
  reconciliationMode: () => FaultRunReconciliationMode;
  admissionConfig: () => ScenarioContractAdmissionConfig;
  createRun: (command: CreateFaultRunCommand) => ReturnType<ReturnType<typeof getFaultRunCoordinator>['create']>;
  verifyOwnershipSchema: typeof verifyFaultRunOwnershipSchema;
  recordAudit: typeof recordOperatorAudit;
  attachAudit: typeof attachOperatorAudit;
  traceId: typeof getOrCreateTraceId;
  csrfValid: typeof isCsrfRequest;
}

const webAdmissionConfig = readScenarioContractWebConfig();

const defaultDependencies: FaultRunCreateRouteDependencies = {
  safeRuntimeEnabled: () => env.FAULT_RUN_SAFE_RUNTIME_ENABLED,
  reconciliationMode: () => env.FAULT_RUN_RECONCILIATION_MODE,
  admissionConfig: () => webAdmissionConfig,
  createRun: (command) => getFaultRunCoordinator().create(command),
  verifyOwnershipSchema: verifyFaultRunOwnershipSchema,
  recordAudit: recordOperatorAudit,
  attachAudit: attachOperatorAudit,
  traceId: getOrCreateTraceId,
  csrfValid: isCsrfRequest,
};

export function createFaultRunCreateRouteHandler(
  dependencies: FaultRunCreateRouteDependencies = defaultDependencies,
) {
  return async function handleFaultRunCreate(request: NextRequest) {
    if (!dependencies.csrfValid(request)) return jsonError(403, 'CSRF validation failed', 403);
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('REQUEST_BODY_MUST_BE_OBJECT');
      }
      body = parsed as Record<string, unknown>;
    } catch (error) {
      return jsonError(400, errorMessage(error), 400);
    }

    const scenario = typeof body.scenario === 'string' ? body.scenario : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
      return jsonError(400, 'A valid idempotencyKey is required', 400);
    }
    if (body.confirmed !== true) return jsonError(400, 'Confirmation is required', 400);

    const traceId = dependencies.traceId(request.headers);
    try {
      getScenarioDefinition(scenario);
      const parameters = validateScenarioParameters(scenario, body.parameters);
      const reconciliationMode = dependencies.reconciliationMode();
      if (reconciliationMode !== 'OFF') await dependencies.verifyOwnershipSchema();
      const result = await dependencies.createRun({
        scenario,
        parameters,
        idempotencyKey,
        traceId,
        scenarioContractAdmission: dependencies.admissionConfig(),
        ...(reconciliationMode === 'OFF' ? {} : { executionMode: reconciliationMode }),
      });
      if (result.created) {
        const auditId = await dependencies.recordAudit({
          request,
          action: 'FAULT_RUN_CREATE',
          target: scenario,
          parameters,
          result: 'SUCCESS',
          correlationId: traceId,
        });
        await dependencies.attachAudit(result.run.faultRunId, auditId);
      }
      const projection = buildFaultRunOperatorRun(result.run, {
        safeRuntimeEnabled: dependencies.safeRuntimeEnabled(),
      });
      return jsonOk(result.run.execution
        ? { ...projection, action: result.action ? buildFaultRunOperatorAction(result.action) : null }
        : projection, result.created ? 201 : 200);
    } catch (error) {
      if (error instanceof ScenarioContractAdmissionError) {
        await dependencies.recordAudit({
          request,
          action: error.code,
          target: scenario || undefined,
          result: 'FAILURE',
          correlationId: traceId,
        });
        if (error.code === 'SCENARIO_CONTRACT_INVALID') {
          return jsonError(503, 'Scenario contract is temporarily unavailable', 503);
        }
        return jsonError(409, 'This scenario is not available in the configured deployment scope', 409);
      }

      await dependencies.recordAudit({
        request,
        action: 'FAULT_RUN_CREATE',
        target: scenario || undefined,
        parameters: body.parameters,
        result: 'FAILURE',
        correlationId: traceId,
      });
      if (error instanceof FaultRunValidationError) return jsonError(400, error.message, 400);
      if (error instanceof ActiveFaultRunError) {
        return Response.json(
          {
            code: 409,
            message: 'An active Fault Run already exists',
            data: buildFaultRunOperatorRun(error.activeRun, {
              safeRuntimeEnabled: dependencies.safeRuntimeEnabled(),
            }),
          },
          { status: 409 },
        );
      }
      if (error instanceof IdempotencyKeyReuseError) return jsonError(409, error.message, 409);
      if (error instanceof Error && error.message.startsWith('FAULT_RUN_OWNERSHIP_MIGRATION_REQUIRED')) {
        return jsonError(503, 'Fault Run ownership schema is not ready', 503);
      }
      if (error instanceof Error && error.message === 'FAULT_RUN_TARGET_START_FAILED') {
        return jsonError(502, 'Fault Run target could not be started', 502);
      }
      return jsonError(500, 'Failed to create Fault Run', 500);
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
