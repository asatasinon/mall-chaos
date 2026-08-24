import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE, SESSION_TOKEN_COOKIE, USER_ID_COOKIE } from '@/lib/auth';

type AuthResponse = {
  userId: number;
  accessToken: string;
  sessionToken: string;
  expiresAt: string;
  roles: string[];
};

const sessionMaxAge = 7 * 24 * 60 * 60;

function cookieOptions(maxAge = sessionMaxAge) {
  return {
    httpOnly: true,
    secure: process.env.SHOPFRONT_COOKIE_SECURE === 'true'
      || (process.env.SHOPFRONT_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production'),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function clearCookie(response: NextResponse, name: string) {
  response.cookies.set(name, '', { ...cookieOptions(), maxAge: 0 });
}

function logoutResponse() {
  const response = NextResponse.json({ code: 200, message: 'ok', data: null });
  clearCookie(response, ACCESS_TOKEN_COOKIE);
  clearCookie(response, SESSION_TOKEN_COOKIE);
  clearCookie(response, USER_ID_COOKIE);
  return response;
}

async function forward(request: NextRequest, action: string, sessionToken?: string) {
  const baseUrl = process.env.GATEWAY_BASE_URL ?? 'http://localhost:18080';
  const headers = new Headers({ 'content-type': 'application/json', 'x-correlation-id': randomUUID() });
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);
  if (sessionToken) headers.set('x-session-token', sessionToken);
  return fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/${action}`, {
    method: 'POST',
    headers,
    body: action === 'refresh' || action === 'logout' ? undefined : await request.text(),
    cache: 'no-store',
  }).catch(() => null);
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!['register', 'login', 'refresh', 'logout'].includes(action)) {
    return NextResponse.json({ code: 404, message: 'Not found', data: null }, { status: 404 });
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_TOKEN_COOKIE)?.value;
  if (action === 'logout' && !sessionToken) {
    return logoutResponse();
  }

  const upstream = await forward(request, action, sessionToken);
  if (!upstream) {
    return NextResponse.json({ code: 503, message: '认证服务暂时无法连接，请稍后重试', data: null }, { status: 503 });
  }

  const payload = await upstream.json().catch(() => null) as { code?: number; message?: string; data?: AuthResponse | null } | null;
  if (action === 'logout' && payload?.message === 'Invalid session') {
    return logoutResponse();
  }
  if (!upstream.ok || !payload || payload.code !== 200) {
    return NextResponse.json(payload ?? { code: upstream.status, message: '认证请求失败', data: null }, { status: upstream.status });
  }

  if (action === 'logout') {
    return logoutResponse();
  }

  const auth = payload.data;
  if (!auth?.accessToken || !auth.sessionToken || !auth.userId) {
    return NextResponse.json({ code: 502, message: '认证服务返回了无效会话', data: null }, { status: 502 });
  }
  const response = NextResponse.json({
    code: 200,
    message: payload.message ?? 'ok',
    data: { userId: auth.userId, roles: auth.roles, expiresAt: auth.expiresAt },
  });
  response.cookies.set(ACCESS_TOKEN_COOKIE, auth.accessToken, cookieOptions());
  response.cookies.set(SESSION_TOKEN_COOKIE, auth.sessionToken, cookieOptions());
  response.cookies.set(USER_ID_COOKIE, String(auth.userId), cookieOptions());
  return response;
}