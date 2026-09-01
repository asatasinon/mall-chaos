import { NextRequest } from 'next/server';

const OPERATOR_COOKIE = 'operator_session';
const CSRF_COOKIE = 'operator_csrf';
export const OPERATOR_SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const DEFAULT_USERNAME = 'castrel';
const DEFAULT_PASSWORD = 'C@stre1_best_ai';

function sessionSecret(): string | null {
  return process.env.CONTROL_PLANE_SESSION_SECRET || process.env.CASTREL_JWT_SECRET || null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

async function signingKey(): Promise<CryptoKey> {
  const secret = sessionSecret();
  if (!secret) throw new Error('Control plane session secret is not configured');

  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function operatorCredentials(): { username: string; password: string } {
  return {
    username: process.env.CONTROL_PLANE_USERNAME || DEFAULT_USERNAME,
    password: process.env.CONTROL_PLANE_PASSWORD || DEFAULT_PASSWORD,
  };
}

export function isOperatorAuthConfigured(): boolean {
  return Boolean(sessionSecret());
}

export function operatorCookieOptions(maxAge: number) {
  return {
    name: OPERATOR_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.CONTROL_PLANE_COOKIE_SECURE === 'true'
      || (process.env.NODE_ENV === 'production' && process.env.CONTROL_PLANE_COOKIE_SECURE !== 'false'),
    maxAge,
    path: '/',
  };
}

export function createCsrfToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function csrfCookieOptions(maxAge: number) {
  return {
    name: CSRF_COOKIE,
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: process.env.CONTROL_PLANE_COOKIE_SECURE === 'true'
      || (process.env.NODE_ENV === 'production' && process.env.CONTROL_PLANE_COOKIE_SECURE !== 'false'),
    maxAge,
    path: '/',
  };
}

export async function createOperatorSession(): Promise<string> {
  const expiresAt = Date.now() + OPERATOR_SESSION_MAX_AGE * 1000;
  const payload = String(expiresAt);
  const key = await signingKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function isOperatorRequest(request: NextRequest): Promise<boolean> {
  const supplied = request.cookies.get(OPERATOR_COOKIE)?.value;
  if (!supplied) return false;

  const [payload, encodedSignature] = supplied.split('.');
  const expiresAt = Number(payload);
  if (!payload || !encodedSignature || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  try {
    const key = await signingKey();
    return await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(encodedSignature),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
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