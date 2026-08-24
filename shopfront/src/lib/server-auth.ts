import type { NextResponse } from 'next/server';
import { ACCESS_TOKEN_COOKIE, SESSION_TOKEN_COOKIE, USER_ID_COOKIE } from './auth';

export function authCookieOptions(maxAge = 7 * 24 * 60 * 60) {
  return {
    httpOnly: true,
    secure: process.env.SHOPFRONT_COOKIE_SECURE === 'true'
      || (process.env.SHOPFRONT_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production'),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of [ACCESS_TOKEN_COOKIE, SESSION_TOKEN_COOKIE, USER_ID_COOKIE]) {
    response.cookies.set(name, '', { ...authCookieOptions(), maxAge: 0 });
  }
  return response;
}