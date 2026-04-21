import { v4 as uuidv4 } from 'uuid';

const TRACE_HEADER = 'X-Trace-Id';

export function getOrCreateTraceId(headers?: Headers): string {
  const existing = headers?.get(TRACE_HEADER);
  return existing || uuidv4().replace(/-/g, '');
}

export function withTrace(init: RequestInit = {}, traceId?: string): RequestInit {
  const tid = traceId || uuidv4().replace(/-/g, '');
  const headers = new Headers(init.headers);
  headers.set(TRACE_HEADER, tid);
  return { ...init, headers };
}

export { TRACE_HEADER };
