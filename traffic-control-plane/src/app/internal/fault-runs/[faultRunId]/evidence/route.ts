import { NextRequest } from 'next/server';
import { handleEvidenceLatestManifest } from '@/lib/evidence-api-route-handlers';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  return handleEvidenceLatestManifest(request, faultRunId);
}
