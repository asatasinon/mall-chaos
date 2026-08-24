import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_TOKEN_COOKIE, SESSION_TOKEN_COOKIE, USER_ID_COOKIE } from '@/lib/auth';

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(USER_ID_COOKIE)?.value;
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const sessionToken = cookieStore.get(SESSION_TOKEN_COOKIE)?.value;
  if (!userId || !accessToken || !sessionToken) {
    return NextResponse.json({ code: 401, message: '未登录', data: null }, { status: 401 });
  }
  return NextResponse.json({ code: 200, message: 'ok', data: { userId: Number(userId), roles: ['CUSTOMER'], expiresAt: '' } });
}