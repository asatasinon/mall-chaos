import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { isCsrfRequest } from '@/lib/csrf';

export async function POST(request: NextRequest) {
  if (!isCsrfRequest(request)) return jsonError(403, 'CSRF validation failed', 403);
  return jsonError(409, 'SCENARIO_CLEANUP_REQUIRES_RUN', 409);
}
