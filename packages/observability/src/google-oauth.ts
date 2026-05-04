import { loadGoogleOAuthEnv } from '@aaa/config';
import { createHttpClient } from './http-client.js';

const googleHttpClient = createHttpClient({
  component: 'google-oauth-client',
  eventPrefix: 'google_oauth.http',
});

export interface RefreshableGoogleCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export async function refreshGoogleAccessToken<T extends RefreshableGoogleCredentials>(
  credentials: T,
  onRefresh?: (credentials: T) => Promise<void>,
): Promise<T> {
  if (!credentials.expiresAt || Date.parse(credentials.expiresAt) - Date.now() > 60_000) {
    return credentials;
  }
  if (!credentials.refreshToken) {
    return credentials;
  }

  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = loadGoogleOAuthEnv();
  if (!clientId || !clientSecret) {
    return credentials;
  }

  const response = await googleHttpClient.requestJson<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const nextCredentials = {
    ...credentials,
    accessToken: response.access_token,
    expiresAt: new Date(Date.now() + response.expires_in * 1000).toISOString(),
    refreshToken: response.refresh_token ?? credentials.refreshToken,
  };
  await onRefresh?.(nextCredentials);
  return nextCredentials;
}
