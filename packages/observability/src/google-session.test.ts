import { describe, expect, it } from 'vitest';
import { GoogleCredentialSession } from './google-session.js';

describe('GoogleCredentialSession', () => {
  it('returns the current access token when no refresh is needed', async () => {
    const session = new GoogleCredentialSession({ accessToken: 'token-1' });
    await expect(session.getAccessToken()).resolves.toBe('token-1');
  });

  it('builds a Bearer authorization header', async () => {
    const session = new GoogleCredentialSession({
      accessToken: 'token-2',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await expect(session.authorizationHeaders()).resolves.toEqual({
      Authorization: 'Bearer token-2',
    });
  });

  it('does not invoke onRefresh for a valid, non-expiring token', async () => {
    let refreshCalls = 0;
    const session = new GoogleCredentialSession(
      { accessToken: 'token-3', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      async () => {
        refreshCalls += 1;
      },
    );
    await session.getAccessToken();
    expect(refreshCalls).toBe(0);
  });
});
