import { NextRequest } from 'next/server';
import {
  handleEvidenceNoteHistory,
  handleEvidenceNotePost,
} from '@/lib/evidence-api-route-handlers';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  return handleEvidenceNoteHistory(request, faultRunId);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ faultRunId: string }> },
) {
  const { faultRunId } = await context.params;
  return handleEvidenceNotePost(request, faultRunId);
}
