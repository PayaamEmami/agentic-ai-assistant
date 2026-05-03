import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAuthToken, verifyAuthToken } from './jwt.js';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

function base64UrlEncode(input: Buffer | string): string {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return raw.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function hmacSha256(input: string, secret: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(input).digest());
}

interface CraftOptions {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  secret?: string;
  signature?: string;
}

function craftToken(options: CraftOptions = {}): string {
  const header = options.header ?? { alg: 'HS256', typ: 'JWT' };
  const payload = options.payload ?? {
    sub: 'user-1',
    email: 'user@example.com',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature =
    options.signature ?? hmacSha256(signingInput, options.secret ?? TEST_SECRET);
  return `${signingInput}.${signature}`;
}

function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  const raw = parts[1] ?? '';
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('jwt', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('signAuthToken / verifyAuthToken round-trip', () => {
    it('returns the expected claims for a freshly signed token', () => {
      const before = Math.floor(Date.now() / 1000);
      const token = signAuthToken('user-123', 'alice@example.com');
      const claims = verifyAuthToken(token);

      expect(claims).not.toBeNull();
      expect(claims?.sub).toBe('user-123');
      expect(claims?.email).toBe('alice@example.com');
      expect(claims?.iat).toBeGreaterThanOrEqual(before);
      expect(claims?.exp).toBe((claims?.iat ?? 0) + SEVEN_DAYS_SECONDS);
    });

    it('default expiry is 7 days', () => {
      const token = signAuthToken('user-123', 'alice@example.com');
      const claims = verifyAuthToken(token);
      expect(claims).not.toBeNull();
      expect((claims?.exp ?? 0) - (claims?.iat ?? 0)).toBe(SEVEN_DAYS_SECONDS);
    });

    it('honors a custom expiresInSeconds', () => {
      const token = signAuthToken('user-123', 'alice@example.com', 60);
      const claims = verifyAuthToken(token);
      expect(claims).not.toBeNull();
      expect((claims?.exp ?? 0) - (claims?.iat ?? 0)).toBe(60);
    });
  });

  describe('expiry handling', () => {
    it('verifies successfully before expiry and rejects after', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const token = signAuthToken('user-123', 'alice@example.com', 60);
      expect(verifyAuthToken(token)).not.toBeNull();

      vi.advanceTimersByTime(30_000);
      expect(verifyAuthToken(token)).not.toBeNull();

      vi.advanceTimersByTime(31_000);
      expect(verifyAuthToken(token)).toBeNull();
    });

    it('rejects a token whose exp is explicitly in the past', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = craftToken({
        payload: { sub: 'user-1', email: 'user@example.com', iat: now - 120, exp: now - 60 },
      });
      expect(verifyAuthToken(token)).toBeNull();
    });
  });

  describe('tampering rejection', () => {
    it('rejects a token with a tampered payload', () => {
      const token = signAuthToken('user-123', 'alice@example.com');
      const [header, , signature] = token.split('.');
      const tamperedPayload = base64UrlEncode(
        JSON.stringify({
          ...decodePayload(token),
          sub: 'attacker',
        }),
      );
      expect(verifyAuthToken(`${header}.${tamperedPayload}.${signature}`)).toBeNull();
    });

    it('rejects a token with a tampered signature', () => {
      const token = signAuthToken('user-123', 'alice@example.com');
      const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
      expect(verifyAuthToken(tampered)).toBeNull();
    });

    it('rejects a token signed with a different secret', () => {
      const token = signAuthToken('user-123', 'alice@example.com');
      vi.stubEnv('JWT_SECRET', 'different-secret');
      expect(verifyAuthToken(token)).toBeNull();
    });
  });

  describe('malformed input', () => {
    it.each([
      ['empty string', ''],
      ['no dots', 'abcdef'],
      ['one dot', 'abc.def'],
      ['four dots', 'a.b.c.d.e'],
      ['empty header part', '.b.c'],
      ['empty payload part', 'a..c'],
      ['empty signature part', 'a.b.'],
    ])('returns null for %s', (_label, value) => {
      expect(verifyAuthToken(value)).toBeNull();
    });

    it('returns null when header is not valid base64-encoded JSON', () => {
      const payload = base64UrlEncode(
        JSON.stringify({ sub: 'u', email: 'u@e.com', iat: 0, exp: 9_999_999_999 }),
      );
      const garbageHeader = base64UrlEncode('not-json');
      const signature = hmacSha256(`${garbageHeader}.${payload}`, TEST_SECRET);
      expect(verifyAuthToken(`${garbageHeader}.${payload}.${signature}`)).toBeNull();
    });
  });

  describe('header validation', () => {
    it('rejects alg: "none"', () => {
      const token = craftToken({ header: { alg: 'none', typ: 'JWT' } });
      expect(verifyAuthToken(token)).toBeNull();
    });

    it('rejects alg: "HS512"', () => {
      const token = craftToken({ header: { alg: 'HS512', typ: 'JWT' } });
      expect(verifyAuthToken(token)).toBeNull();
    });

    it('rejects typ: "JWE"', () => {
      const token = craftToken({ header: { alg: 'HS256', typ: 'JWE' } });
      expect(verifyAuthToken(token)).toBeNull();
    });
  });

  describe('claim validation', () => {
    const futureExp = () => Math.floor(Date.now() / 1000) + 3600;

    it('rejects a token missing sub', () => {
      const token = craftToken({
        payload: { email: 'user@example.com', iat: 0, exp: futureExp() },
      });
      expect(verifyAuthToken(token)).toBeNull();
    });

    it('rejects a token with empty sub', () => {
      const token = craftToken({
        payload: { sub: '', email: 'user@example.com', iat: 0, exp: futureExp() },
      });
      expect(verifyAuthToken(token)).toBeNull();
    });

    it('rejects a token missing email', () => {
      const token = craftToken({
        payload: { sub: 'user-1', iat: 0, exp: futureExp() },
      });
      expect(verifyAuthToken(token)).toBeNull();
    });

    it('rejects a token with empty email', () => {
      const token = craftToken({
        payload: { sub: 'user-1', email: '', iat: 0, exp: futureExp() },
      });
      expect(verifyAuthToken(token)).toBeNull();
    });

    it('rejects a token with non-numeric exp', () => {
      const token = craftToken({
        payload: { sub: 'user-1', email: 'user@example.com', iat: 0, exp: 'soon' },
      });
      expect(verifyAuthToken(token)).toBeNull();
    });

    it('rejects a token with no exp at all', () => {
      const token = craftToken({
        payload: { sub: 'user-1', email: 'user@example.com', iat: 0 },
      });
      expect(verifyAuthToken(token)).toBeNull();
    });
  });

  describe('signature length safety', () => {
    it('returns null without throwing when signature length differs from expected', () => {
      const token = craftToken({ signature: 'short' });
      expect(() => verifyAuthToken(token)).not.toThrow();
      expect(verifyAuthToken(token)).toBeNull();
    });
  });

  describe('dev-secret fallback', () => {
    it('round-trips successfully when JWT_SECRET is unset', () => {
      vi.stubEnv('JWT_SECRET', '');
      const token = signAuthToken('user-123', 'alice@example.com', 60);
      const claims = verifyAuthToken(token);
      expect(claims).not.toBeNull();
      expect(claims?.sub).toBe('user-123');
    });

    it('round-trips successfully when JWT_SECRET is whitespace only', () => {
      vi.stubEnv('JWT_SECRET', '   ');
      const token = signAuthToken('user-123', 'alice@example.com', 60);
      const claims = verifyAuthToken(token);
      expect(claims).not.toBeNull();
    });
  });
});
