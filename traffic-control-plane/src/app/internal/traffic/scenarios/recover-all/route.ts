import { recoverAll } from '@/lib/scenarios';
import { getOrCreateTraceId } from '@/lib/trace';
import { jsonOk } from '@/lib/api-response';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const traceId = getOrCreateTraceId(request.headers);
  const result = await recoverAll(traceId);
  return jsonOk(result);
}
