import { NextRequest, NextResponse } from 'next/server';
import { isOperatorRequest, operatorId } from '@/lib/operator-auth';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isInternalRequest = pathname.startsWith('/internal/');
  const isLoginRequest = pathname === '/login';
  const isSessionRequest = pathname === '/api/operator/session';

  if (isLoginRequest || isSessionRequest) {
    return NextResponse.next();
  }

  if (!(await isOperatorRequest(request))) {
    if (!isInternalRequest && pathname.startsWith('/api/')) {
      return NextResponse.json(
        { code: 401, message: 'Operator authentication required', data: null },
        { status: 401 },
      );
    }

    if (!isInternalRequest) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.search = '';
      loginUrl.searchParams.set('returnTo', `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.json(
      { code: 401, message: 'Operator authentication required', data: null },
      { status: 401 },
    );
  }

  const requestHeaders = new Headers(request.headers);
  const id = operatorId();
  if (id !== null) requestHeaders.set('x-operator-id', String(id));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};