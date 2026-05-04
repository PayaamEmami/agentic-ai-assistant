import crypto from 'node:crypto';
import { loadJwtEnv } from '@aaa/config';

export interface AuthTokenClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

function base64UrlEncode(input: Buffer | string): string {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return raw.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function hmacSha256(input: string, secret: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(input).digest());
}

function getJwtSecret(): string {
  return loadJwtEnv().JWT_SECRET;
}

export function signAuthToken(
  userId: string,
  email: string,
  expiresInSeconds = 60 * 60 * 24 * 7,
): string {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenClaims = {
    sub: userId,
    email,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = hmacSha256(signingInput, getJwtSecret());

  return `${signingInput}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }

  let header: JwtHeader;
  let payload: AuthTokenClaims;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader)) as JwtHeader;
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as AuthTokenClaims;
  } catch {
    return null;
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = hmacSha256(signingInput, getJwtSecret());

  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return null;
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return null;
  }
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    return null;
  }

  return payload;
}
