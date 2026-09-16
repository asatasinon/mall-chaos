import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { env } from '@/lib/env';
import { getCatalogRevision } from '@/lib/fault-run-catalog-revision';
import { FaultRunValidationError, getScenarioDefinition } from '@/lib/fault-run-catalog';
import {
  assertPilotSelectionEligible,
  BaselinePilotValidationError,
  parsePilotReviewInput,
} from '@/lib/baseline-pilot';
import { SqlBaselineRepository } from '@/lib/baseline-repository';
import { recordOperatorAudit, updateOperatorAuditResult } from '@/lib/operator-audit';

const repository = new SqlBaselineRepository();

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ scenario: string }> },
) {
  const { scenario } = await context.params;
  const correlationId = crypto.randomUUID();
  if (!isCsrfRequest(request)) {
    await recordPilotFailureAudit(request, scenario, correlationId);
    return jsonError(403, 'CSRF validation failed', 403);
  }
  if (!env.BASELINE_CAPTURE_ENABLED) {
    await recordPilotFailureAudit(request, scenario, correlationId);
    return jsonError(404, 'BASELINE_CAPTURE_DISABLED', 404);
  }

  let auditId: number | null = null;
  try {
    getScenarioDefinition(scenario);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      await recordPilotFailureAudit(request, scenario, correlationId);
      return jsonError(400, 'INVALID_PILOT_REVIEW', 400);
    }
    const currentCatalogRevision = getCatalogRevision();
    const input = parsePilotReviewInput(scenario, body, currentCatalogRevision);
    if (input.decision === 'SELECTED') {
      const baselines = await repository.list({
        scenario: input.scenario,
        catalogRevision: input.catalogRevision,
      });
      assertPilotSelectionEligible(baselines);
    }

    auditId = await recordOperatorAudit({
      request,
      action: 'BASELINE_PILOT_REVIEW_UPDATE',
      target: input.scenario,
      parameters: {
        scenario: input.scenario,
        catalogRevision: input.catalogRevision,
        decision: input.decision,
      },
      result: 'FAILURE',
      correlationId,
    });
    if (auditId < 1) throw new Error('PILOT_REVIEW_AUDIT_CREATE_FAILED');
    const result = await repository.savePilotReview({
      ...input,
      operatorAuditId: auditId,
    });
    await updateOperatorAuditResult(auditId, 'SUCCESS');
    return jsonOk(result);
  } catch (error) {
    if (auditId !== null) {
      await updateOperatorAuditResult(auditId, 'FAILURE').catch(() => undefined);
    } else {
      await recordPilotFailureAudit(request, scenario, correlationId);
    }
    return pilotErrorResponse(error);
  }
}

function pilotErrorResponse(error: unknown): Response {
  if (error instanceof FaultRunValidationError) {
    return jsonError(400, error.message, 400);
  }
  if (error instanceof BaselinePilotValidationError) {
    const status = error.code === 'PILOT_REVIEW_CONFLICT' ? 409
      : error.code === 'PILOT_BASELINE_REQUIRED'
        || error.code === 'PILOT_BASELINE_INCOMPLETE'
        || error.code === 'PILOT_EVIDENCE_UNAVAILABLE' ? 422 : 400;
    return jsonError(status, error.code, status);
  }
  if (error instanceof Error && error.message.startsWith('PILOT_REVIEW_')) {
    return jsonError(409, error.message, 409);
  }
  if (error instanceof Error && error.message === 'PILOT_ALREADY_SELECTED') {
    return jsonError(409, error.message, 409);
  }
  if (error instanceof Error && error.message === 'PILOT_REVIEW_LOCK_TIMEOUT') {
    return jsonError(409, error.message, 409);
  }
  if (error instanceof Error && error.message === 'CATALOG_REVISION_FAILED') {
    return jsonError(500, error.message, 500);
  }
  return jsonError(503, 'Unable to save pilot review', 503);
}

async function recordPilotFailureAudit(
  request: NextRequest,
  scenario: string,
  correlationId: string,
): Promise<void> {
  await recordOperatorAudit({
    request,
    action: 'BASELINE_PILOT_REVIEW_UPDATE',
    target: scenario,
    parameters: { scenario },
    result: 'FAILURE',
    correlationId,
  }).catch(() => undefined);
}
