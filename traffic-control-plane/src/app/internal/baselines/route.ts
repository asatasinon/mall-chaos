import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isBaselineCaptureStatus, type BaselineCaptureStatus } from '@/lib/baseline-schema';
import { getScenarioDefinition, type FaultRunScenario } from '@/lib/fault-run-catalog';
import { SqlBaselineRepository } from '@/lib/baseline-repository';

const repository = new SqlBaselineRepository();

export async function GET(request: NextRequest) {
  const scenarioValue = request.nextUrl.searchParams.get('scenario');
  const captureStatusValue = request.nextUrl.searchParams.get('captureStatus');
  const catalogRevision = request.nextUrl.searchParams.get('catalogRevision') || undefined;
  const limitValue = request.nextUrl.searchParams.get('limit');
  let scenario: FaultRunScenario | undefined;
  let captureStatus: BaselineCaptureStatus | undefined;
  let limit: number | undefined;
  try {
    scenario = scenarioValue ? getScenarioDefinition(scenarioValue).scenario : undefined;
    captureStatus = captureStatusValue
      ? assertCaptureStatus(captureStatusValue)
      : undefined;
    limit = limitValue === null ? undefined : parseLimit(limitValue);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : 'Invalid baseline query', 400);
  }
  try {
    return jsonOk({
      baselines: await repository.list({ scenario, captureStatus, catalogRevision, limit }),
    });
  } catch {
    return jsonError(503, 'Baselines are unavailable', 503);
  }
}

function assertCaptureStatus(value: string) {
  if (!isBaselineCaptureStatus(value)) throw new Error('Invalid captureStatus');
  return value;
}

function parseLimit(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('Invalid limit');
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw new Error('Invalid limit');
  return limit;
}
