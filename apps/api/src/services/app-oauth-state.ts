import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import type { AppKind, OAuthStatePayload } from './app-service-types.js';

export function requireEnv(key: string, configuredValue: string | undefined): string {
  const value = configuredValue;
  if (!value) {
    throw new AppError(500, `Missing required environment variable: ${key}`, 'CONFIG_MISSING');
  }
  return value;
}

function normalizeRedirectBase(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

export function buildGoogleRedirectUri(config: AppConfig): string {
  return new URL(
    'callback',
    normalizeRedirectBase(
      requireEnv('GOOGLE_APP_REDIRECT_URI_BASE', config.googleAppRedirectUriBase),
    ),
  ).toString();
}

export function buildGitHubRedirectUri(config: AppConfig): string {
  return new URL(
    'callback',
    normalizeRedirectBase(
      requireEnv('GITHUB_APP_REDIRECT_URI_BASE', config.githubAppRedirectUriBase),
    ),
  ).toString();
}

function getOAuthStateSecret(config: AppConfig): string {
  return config.jwtSecret;
}

export function signOAuthState(payload: OAuthStatePayload, config: AppConfig): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getOAuthStateSecret(config))
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function timingSafeEqualString(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.byteLength === expectedBuffer.byteLength &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function parseOAuthStatePayload(encodedPayload: string): OAuthStatePayload {
  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    throw new AppError(400, 'Invalid app state payload', 'APP_INVALID_STATE');
  }
}

export function verifyOAuthState(state: string, config: AppConfig): OAuthStatePayload {
  const parts = state.split('.');
  if (parts.length !== 2) {
    throw new AppError(400, 'Invalid app state', 'APP_INVALID_STATE');
  }

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    throw new AppError(400, 'Invalid app state', 'APP_INVALID_STATE');
  }

  const expectedSignature = crypto
    .createHmac('sha256', getOAuthStateSecret(config))
    .update(encodedPayload)
    .digest('base64url');
  if (!timingSafeEqualString(signature, expectedSignature)) {
    throw new AppError(400, 'Invalid app state signature', 'APP_INVALID_STATE');
  }

  const payload = parseOAuthStatePayload(encodedPayload);
  if (typeof payload.flowId !== 'string' || payload.flowId.trim().length === 0) {
    throw new AppError(400, 'App state is missing flow context', 'APP_INVALID_STATE');
  }
  if (typeof payload.userId !== 'string' || payload.userId.trim().length === 0) {
    throw new AppError(400, 'App state is missing user context', 'APP_INVALID_STATE');
  }
  if (payload.expiresAt < Date.now()) {
    throw new AppError(400, 'App state has expired', 'APP_STATE_EXPIRED');
  }
  if (!isAppKind(payload.appKind)) {
    throw new AppError(400, 'Unsupported app state', 'APP_INVALID_STATE');
  }

  return payload;
}

function isAppKind(value: unknown): value is AppKind {
  return value === 'github' || value === 'google';
}
