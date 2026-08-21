import { NextRequest } from 'next/server';

const OPERATOR_COOKIE = 'operator_session';

export function isOperatorRequest(request: NextRequest): boolean {
  const expected = process.env.OPERATOR_SESSION_TOKEN;
  if (!expected) return false;

  const bearer = request.headers.get('authorization');
  const supplied = bearer?.startsWith('Bearer ')
    ? bearer.slice('Bearer '.length).trim()
    : request.cookies.get(OPERATOR_COOKIE)?.value;

  return Boolean(supplied && supplied === expected);
}

export function operatorId(): number | null {
  const value = process.env.OPERATOR_ID;
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

export function operatorUnauthorizedResponse(): Response {
  return Response.json(
    { code: 401, message: 'Operator authentication required', data: null },
    { status: 401 },
  );
}