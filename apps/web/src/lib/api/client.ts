import { createCorrelationId } from '../client-observability';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const TOKEN_STORAGE_KEY = 'aaa_auth_token';

let cachedToken: string | null = null;

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getStoredAuthToken(): string | null {
  if (cachedToken) {
    return cachedToken;
  }

  if (canUseBrowserStorage()) {
    const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      cachedToken = stored;
      return stored;
    }
  }

  return null;
}

export function setStoredAuthToken(token: string): void {
  cachedToken = token;
  if (canUseBrowserStorage()) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }
}

export function clearStoredAuthToken(): void {
  cachedToken = null;
  if (canUseBrowserStorage()) {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public requestId?: string,
    public correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function getAuthToken(): Promise<string> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
  }
  return token;
}

function buildHeaders(options?: RequestInit, authToken?: string): Headers {
  const headers = new Headers(options?.headers);

  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  if (
    options?.body != null &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

// Single fetch executor shared by the authenticated and public request helpers.
// It attaches a correlation id, applies auth headers when a token is supplied,
// and converts non-2xx responses into an `ApiError` before returning the raw
// `Response` so callers can decode it as JSON or text.
async function execute(
  path: string,
  options: RequestInit | undefined,
  authToken: string | undefined,
): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const correlationId = createCorrelationId('http');
  const headers = buildHeaders(options, authToken);
  headers.set('x-correlation-id', correlationId);
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body?.error?.message ?? 'Request failed',
      body?.error?.code,
      res.headers.get('x-request-id') ?? undefined,
      res.headers.get('x-correlation-id') ?? correlationId,
    );
  }

  return res;
}

export async function requestPublic<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await execute(path, options, undefined);
  return res.json() as Promise<T>;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const res = await execute(path, options, token);
  return res.json() as Promise<T>;
}

export async function requestText(path: string, options?: RequestInit): Promise<string> {
  const token = await getAuthToken();
  const res = await execute(path, options, token);
  return res.text();
}

export function buildWebSocketUrl(
  token: string,
  correlationId = createCorrelationId('ws'),
): string {
  const base = new URL(API_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws/events';
  base.searchParams.set('token', token);
  base.searchParams.set('correlationId', correlationId);
  return base.toString();
}
