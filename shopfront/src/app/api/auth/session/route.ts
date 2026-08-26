import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_TOKEN_COOKIE, SESSION_TOKEN_COOKIE, USER_ID_COOKIE } from '@/lib/auth';
import { clearAuthCookies } from '@/lib/server-auth';

type UserProfilePayload = {
  code?: number;
  data?: { nickname?: string; email?: string | null } | null;
};

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(USER_ID_COOKIE)?.value;
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const sessionToken = cookieStore.get(SESSION_TOKEN_COOKIE)?.value;
  if (!userId || !accessToken || !sessionToken) {
    return NextResponse.json({ code: 401, message: 'Not signed in', data: null }, { status: 401 });
  }

  const baseUrl = process.env.GATEWAY_BASE_URL ?? 'http://localhost:18080';
  const profileResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/api/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).catch(() => null);
  const profilePayload = profileResponse
    ? await profileResponse.json().catch(() => null) as UserProfilePayload | null
    : null;
  if (profileResponse?.status === 401) {
    const response = NextResponse.json({ code: 401, message: 'Session expired. Please sign in again.', data: null }, { status: 401 });
    response.headers.set('x-session-expired', '1');
    return clearAuthCookies(response);
  }
  const profile = profileResponse?.ok && profilePayload?.code === 200 ? profilePayload.data : null;

  return NextResponse.json({
    code: 200,
    message: 'ok',
    data: {
      userId: Number(userId),
      roles: ['CUSTOMER'],
      expiresAt: '',
      ...(profile?.nickname ? { nickname: profile.nickname } : {}),
      ...(profile?.email ? { email: profile.email } : {}),
    },
  });
}