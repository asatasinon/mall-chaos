import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { env } from '@/lib/env';
import {
  FaultRunValidationError,
  getScenarioDefinition,
  listScenarioDefinitions,
  type FaultRunState,
  type FaultRunScenario,
} from '@/lib/fault-run-catalog';
import { listFaultRuns } from '@/lib/fault-run-repository';
import { buildFaultRunOperatorRun } from '@/lib/fault-run-operator-view';
import { createFaultRunCreateRouteHandler } from '@/lib/fault-run-create-route-handler';

export const POST = createFaultRunCreateRouteHandler();

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
    return jsonOk({
      scenarios: listScenarioDefinitions(),
      runs: runs.map((run) => buildFaultRunOperatorRun(run, {
        safeRuntimeEnabled: env.FAULT_RUN_SAFE_RUNTIME_ENABLED,
      })),
    });
  } catch (error) {
    return jsonError(400, errorMessage(error), 400);
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
