import { NextRequest } from 'next/server';
import { handleEvidenceManifestDetail } from '@/lib/evidence-api-route-handlers';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ faultRunId: string; manifestId: string }> },
) {
  const { faultRunId, manifestId } = await context.params;
  return handleEvidenceManifestDetail(request, faultRunId, manifestId);
}
