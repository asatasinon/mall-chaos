import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';
import { env } from '@/lib/env';
import {
  BaselineCaptureError,
} from '@/lib/baseline-capture-errors';
import { captureScenarioBaseline } from '@/lib/baseline-capture';
import {
  loadScenarioBaselineBySourceFaultRunId,
  SqlBaselineRepository,
} from '@/lib/baseline-repository';
import { recordOperatorAudit, updateOperatorAuditResult } from '@/lib/operator-audit';

const repository = new SqlBaselineRepository();

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  if (!isUuid(faultRunId)) return jsonError(400, 'Invalid faultRunId', 400);
  try {
    const baseline = await loadScenarioBaselineBySourceFaultRunId(faultRunId);
    if (!baseline) return jsonError(404, 'Baseline not found', 404);
    return jsonOk(baseline);
  } catch {
    return jsonError(503, 'Baseline is unavailable', 503);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  const correlationId = randomUUID();
  if (!isUuid(faultRunId)) {
    await recordFailureAudit(request, faultRunId, correlationId);
    return jsonError(400, 'Invalid faultRunId', 400);
  }
  if (!isCsrfRequest(request)) {
    await recordFailureAudit(request, faultRunId, correlationId);
    return jsonError(403, 'CSRF validation failed', 403);
  }
  if (!env.BASELINE_CAPTURE_ENABLED) {
    await recordFailureAudit(request, faultRunId, correlationId);
    return jsonError(404, 'BASELINE_CAPTURE_DISABLED', 404);
  }

  let auditId: number | null = null;
  try {
    const result = await repository.withSourceFaultRunLock(faultRunId, async () => {
      const existing = await repository.findBySourceFaultRunId(faultRunId);
      if (existing) return { baseline: existing, created: false };

      auditId = await recordOperatorAudit({
        request,
        action: 'BASELINE_CAPTURE',
        target: faultRunId,
        parameters: { sourceFaultRunId: faultRunId },
        result: 'FAILURE',
        correlationId,
      });
      if (auditId < 1) throw new Error('BASELINE_AUDIT_CREATE_FAILED');
      const captured = await captureScenarioBaseline(
        faultRunId,
        { operatorAuditId: auditId, skipLock: true },
      );
      await updateOperatorAuditResult(auditId, 'SUCCESS');
      return captured;
    });
    return jsonOk(result, result.created ? 201 : 200);
  } catch (error) {
    if (auditId !== null) {
      await updateOperatorAuditResult(auditId, 'FAILURE').catch(() => undefined);
    } else {
      await recordFailureAudit(request, faultRunId, correlationId);
    }
    return captureErrorResponse(error);
  }
}

function captureErrorResponse(error: unknown): Response {
  if (error instanceof BaselineCaptureError) {
    return jsonError(error.status, error.code, error.status);
  }
  if (error instanceof Error && error.message === 'BASELINE_NOT_FOUND') {
    return jsonError(404, 'Baseline not found', 404);
  }
  return jsonError(500, 'Failed to capture baseline', 500);
}

async function recordFailureAudit(
  request: NextRequest,
  faultRunId: string,
  correlationId: string,
): Promise<void> {
  await recordOperatorAudit({
    request,
    action: 'BASELINE_CAPTURE',
    target: faultRunId,
    parameters: { sourceFaultRunId: faultRunId },
    result: 'FAILURE',
    correlationId,
  }).catch(() => undefined);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
