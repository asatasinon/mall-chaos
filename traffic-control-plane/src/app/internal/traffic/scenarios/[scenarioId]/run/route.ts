import { PRESET_SCENARIOS, executeScenario } from '@/lib/scenarios';
import { getOrCreateTraceId } from '@/lib/trace';
import { jsonOk, jsonError } from '@/lib/api-response';
import { NextRequest } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scenarioId: string }> }
) {
  const { scenarioId } = await params;
  const scenario = PRESET_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) {
    return jsonError(404, `Scenario '${scenarioId}' not found`, 404);
  }

  const traceId = getOrCreateTraceId(request.headers);
  const result = await executeScenario(scenario, traceId);
  return jsonOk(result);
}
