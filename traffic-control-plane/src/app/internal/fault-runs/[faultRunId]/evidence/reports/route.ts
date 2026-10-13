import { NextRequest } from 'next/server';
import {
  handleEvidenceReportHistory,
  handleEvidenceReportPost,
} from '@/lib/evidence-api-route-handlers';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  return handleEvidenceReportHistory(request, faultRunId);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  return handleEvidenceReportPost(request, faultRunId);
}
