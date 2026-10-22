import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  clearStoredAuthToken,
  getAuthToken,
  notifySessionExpired,
  request,
  requestErrorMessage,
  requestPublic,
  resetSessionExpired,
  SessionExpiredError,
  setSessionExpiredHandler,
  setStoredAuthToken,
} from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('session expiry', () => {
  afterEach(() => {
    resetSessionExpired();
    clearStoredAuthToken();
    setSessionExpiredHandler(null);
    vi.unstubAllGlobals();
  });

  it('sends an authenticated 401 to the sign-in page instead of the API message', async () => {
    setStoredAuthToken('stored-token');
    const onExpired = vi.fn(() => {
      clearStoredAuthToken();
    });
    setSessionExpiredHandler(onExpired);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          jsonResponse(401, {
            error: { message: 'Invalid or expired token', code: 'AUTH_INVALID' },
          }),
      ),
    );

    await expect(request('/api/auth/me')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(onExpired).toHaveBeenCalledOnce();
    await expect(getAuthToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(requestErrorMessage(new SessionExpiredError(), 'Failed to send message')).toBeNull();
  });

  it('keeps a public 401 as a normal request error', async () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(401, { error: { message: 'Invalid credentials', code: 'AUTH_INVALID' } }),
      ),
    );

    await expect(
      requestPublic('/api/auth/login', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Invalid credentials',
    });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('does not expire the session for other authenticated failures', async () => {
    setStoredAuthToken('stored-token');
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, { error: { message: 'Internal server error' } })),
    );

    await expect(request('/api/chat')).rejects.toBeInstanceOf(ApiError);
    expect(onExpired).not.toHaveBeenCalled();
    await expect(getAuthToken()).resolves.toBe('stored-token');
  });

  it('returns ordinary request text for non-expiry errors', () => {
    expect(requestErrorMessage(new Error('Rename failed'), 'Failed to rename conversation')).toBe(
      'Rename failed',
    );
    expect(requestErrorMessage('nope', 'Failed to rename conversation')).toBe(
      'Failed to rename conversation',
    );
  });

  it('treats a rejected realtime connection as an expired session', async () => {
    setStoredAuthToken('stored-token');
    setSessionExpiredHandler(() => {
      clearStoredAuthToken();
    });

    notifySessionExpired();

    await expect(getAuthToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(requestErrorMessage(new SessionExpiredError(), 'Failed to load conversations')).toBeNull();
  });
});
