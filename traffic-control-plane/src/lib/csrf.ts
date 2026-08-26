import { NextRequest } from 'next/server';

const CSRF_COOKIE = 'operator_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

export function isCsrfRequest(request: NextRequest): boolean {
  const cookie = request.cookies.get(CSRF_COOKIE)?.value;
  const header = request.headers.get(CSRF_HEADER);
  return Boolean(cookie && header && cookie.length >= 32 && cookie === header);
}

export { CSRF_COOKIE, CSRF_HEADER };
