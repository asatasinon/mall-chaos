import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isPilotReviewDecision, type PilotReviewDecision } from '@/lib/baseline-schema';
import { getScenarioDefinition, type FaultRunScenario } from '@/lib/fault-run-catalog';
import { SqlBaselineRepository } from '@/lib/baseline-repository';

const repository = new SqlBaselineRepository();

export async function GET(request: NextRequest) {
  const scenarioValue = request.nextUrl.searchParams.get('scenario');
  const catalogRevision = request.nextUrl.searchParams.get('catalogRevision') || undefined;
  const decisionValue = request.nextUrl.searchParams.get('decision');
  const limitValue = request.nextUrl.searchParams.get('limit');
  let scenario: FaultRunScenario | undefined;
  let decision: PilotReviewDecision | undefined;
  let limit: number | undefined;
  try {
    scenario = scenarioValue ? getScenarioDefinition(scenarioValue).scenario : undefined;
    decision = decisionValue === null ? undefined : assertDecision(decisionValue);
    limit = limitValue === null ? undefined : parseLimit(limitValue);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : 'Invalid pilot review query', 400);
  }
  try {
    return jsonOk({
      reviews: await repository.listPilotReviews({ scenario, catalogRevision, decision, limit }),
    });
  } catch {
    return jsonError(503, 'Pilot reviews are unavailable', 503);
  }

  function assertDecision(value: string) {
    if (!isPilotReviewDecision(value)) throw new Error('Invalid decision');
    return value;
  }
}

function parseLimit(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('Invalid limit');
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw new Error('Invalid limit');
  return limit;
}
