import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import {
  FaultRunValidationError,
  getScenarioDefinition,
  listScenarioDefinitions,
  validateScenarioParameters,
  type FaultRunState,
  type FaultRunScenario,
} from '@/lib/fault-run-catalog';
import { getFaultRunCoordinator } from '@/lib/fault-run-coordinator';
import {
  ActiveFaultRunError,
  IdempotencyKeyReuseError,
  attachOperatorAudit,
  listFaultRuns,
} from '@/lib/fault-run-repository';
import { getOrCreateTraceId } from '@/lib/trace';
import { recordOperatorAudit } from '@/lib/operator-audit';

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || undefined;
  const scenario = request.nextUrl.searchParams.get('scenario') || undefined;
  try {
    if (state) assertState(state);
    if (scenario) getScenarioDefinition(scenario);
    const runs = await listFaultRuns({
      state: state as FaultRunState | undefined,
      scenario: scenario as FaultRunScenario | undefined,
    });
    return jsonOk({ scenarios: listScenarioDefinitions(), runs });
  } catch (error) {
    return jsonError(400, errorMessage(error), 400);
  }
}

export async function POST(request: NextRequest) {
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('REQUEST_BODY_MUST_BE_OBJECT');
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

  try {
    getScenarioDefinition(scenario);
    const parameters = validateScenarioParameters(scenario, body.parameters);
    const traceId = getOrCreateTraceId(request.headers);
    const result = await getFaultRunCoordinator().create({ scenario, parameters, idempotencyKey, traceId });
    const auditId = await recordOperatorAudit({
      request,
      action: 'FAULT_RUN_CREATE',
      target: scenario,
      parameters,
      result: 'SUCCESS',
      correlationId: traceId,
    });
    await attachOperatorAudit(result.run.faultRunId, auditId);
    return jsonOk(result.run, result.created ? 201 : 200);
  } catch (error) {
    const message = errorMessage(error);
    await recordOperatorAudit({
      request,
      action: 'FAULT_RUN_CREATE',
      target: scenario || undefined,
      parameters: body.parameters,
      result: 'FAILURE',
      correlationId: getOrCreateTraceId(request.headers),
    }).catch(() => undefined);
    if (error instanceof FaultRunValidationError) return jsonError(400, message, 400);
    if (error instanceof ActiveFaultRunError) {
      return Response.json(
        { code: 409, message: 'An active Fault Run already exists', data: error.activeRun },
        { status: 409 },
      );
    }
    if (error instanceof IdempotencyKeyReuseError) return jsonError(409, message, 409);
    if (message === 'FAULT_RUN_TARGET_START_FAILED') return jsonError(502, 'Fault Run target could not be started', 502);
    return jsonError(500, 'Failed to create Fault Run', 500);
  }
}

function assertState(value: string): asserts value is FaultRunState {
  if (!['CREATING', 'ACTIVE', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].includes(value)) {
    throw new FaultRunValidationError('UNKNOWN_STATE');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
