import { NextRequest, NextResponse } from 'next/server';
import { isOperatorRequest, operatorId } from '@/lib/operator-auth';

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/internal/')) {
    return NextResponse.next();
  }

  if (!isOperatorRequest(request)) {
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
  matcher: ['/internal/:path*'],
};