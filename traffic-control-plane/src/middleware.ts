import { NextRequest, NextResponse } from 'next/server';
import { isOperatorRequest } from '@/lib/operator-auth';

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

  return NextResponse.next();
}

export const config = {
  matcher: ['/internal/:path*'],
};