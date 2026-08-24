import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth';

const allowedRoots = new Set(['products', 'cart', 'checkout', 'orders', 'payments', 'fulfillments', 'notifications', 'auth', 'users', 'addresses']);

function isAllowed(path: string[]) {
  return path.length > 0 && allowedRoots.has(path[0]) && !path.some((part) => part === '..' || part === 'internal');
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!isAllowed(path)) return NextResponse.json({ code: 404, message: 'Not found', data: null }, { status: 404 });

  const baseUrl = process.env.GATEWAY_BASE_URL ?? 'http://localhost:18080';
  const target = `${baseUrl.replace(/\/$/, '')}/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const cookieStore = await cookies();
  const auth = request.headers.get('authorization') ?? (cookieStore.get(ACCESS_TOKEN_COOKIE)?.value ? `Bearer ${cookieStore.get(ACCESS_TOKEN_COOKIE)?.value}` : process.env.SHOPFRONT_ACCESS_TOKEN ? `Bearer ${process.env.SHOPFRONT_ACCESS_TOKEN}` : null);
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  if (auth) headers.set('authorization', auth);
  headers.set('x-correlation-id', request.headers.get('x-correlation-id') ?? randomUUID());

  const upstream = await fetch(target, { method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(), cache: 'no-store' }).catch(() => null);
  if (!upstream) return NextResponse.json({ code: 503, message: '网关暂时无法连接，请稍后重试', data: null }, { status: 503 });
  return new NextResponse(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
