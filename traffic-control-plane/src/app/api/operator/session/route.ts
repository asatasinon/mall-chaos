import { NextRequest, NextResponse } from 'next/server';
import { error, ok } from '@/lib/api-response';
import {
  createCsrfToken,
  createOperatorSession,
  csrfCookieOptions,
  isOperatorAuthConfigured,
  operatorCookieOptions,
  operatorCredentials,
} from '@/lib/operator-auth';

export async function POST(request: NextRequest) {
  if (!isOperatorAuthConfigured()) {
    return NextResponse.json(error(503, 'Control plane session secret is not configured'), { status: 503 });
  }

  let body: { username?: unknown; password?: unknown } = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as { username?: unknown; password?: unknown };
  } catch {
    return NextResponse.json(error(400, 'Username and password are required'), { status: 400 });
  }

  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json(error(400, 'Username and password are required'), { status: 400 });
  }

  const credentials = operatorCredentials();
  if (body.username !== credentials.username || body.password !== credentials.password) {
    return NextResponse.json(error(401, 'Invalid username or password'), { status: 401 });
  }

  const response = NextResponse.json(ok({ authenticated: true }));
  response.cookies.set({ ...operatorCookieOptions(8 * 60 * 60), value: await createOperatorSession() });
  response.cookies.set({ ...csrfCookieOptions(8 * 60 * 60), value: createCsrfToken() });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json(ok({ authenticated: false }));
  response.cookies.set({ ...operatorCookieOptions(0), value: '' });
  response.cookies.set({ ...csrfCookieOptions(0), value: '' });
  return response;
}