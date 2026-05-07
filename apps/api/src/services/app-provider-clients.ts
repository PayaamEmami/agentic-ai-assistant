import { fetchWithTelemetry, getLogger } from '@aaa/observability';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import {
  buildGitHubRedirectUri,
  buildGoogleRedirectUri,
  requireEnv,
} from './app-oauth-state.js';

export async function exchangeGoogleCode(code: string, config: AppConfig) {
  const logger = getLogger({ component: 'app-service', provider: 'google' });
  const clientId = requireEnv('GOOGLE_CLIENT_ID', config.googleClientId);
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET', config.googleClientSecret);

  const response = await fetchWithTelemetry(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: buildGoogleRedirectUri(config),
      }),
    },
    {
      component: 'app-service',
      provider: 'google',
      eventPrefix: 'app.oauth.token_exchange',
      logResponseBodyOnFailure: false,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error(
      {
        event: 'app.oauth.token_exchange_failed',
        outcome: 'failure',
        provider: 'google',
        statusCode: response.status,
        responseBodyLength: body.length,
      },
      'Google token exchange failed',
    );
    throw new AppError(502, 'Google token exchange failed', 'GOOGLE_TOKEN_EXCHANGE_FAILED');
  }

  logger.info(
    {
      event: 'app.oauth.token_exchanged',
      outcome: 'success',
      provider: 'google',
    },
    'Google token exchange succeeded',
  );

  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export async function exchangeGitHubCode(code: string, config: AppConfig) {
  const logger = getLogger({ component: 'app-service', provider: 'github' });
  const clientId = requireEnv('GITHUB_CLIENT_ID', config.githubClientId);
  const clientSecret = requireEnv('GITHUB_CLIENT_SECRET', config.githubClientSecret);

  const response = await fetchWithTelemetry(
    'https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: buildGitHubRedirectUri(config),
      }),
    },
    {
      component: 'app-service',
      provider: 'github',
      eventPrefix: 'app.oauth.token_exchange',
      logResponseBodyOnFailure: false,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error(
      {
        event: 'app.oauth.token_exchange_failed',
        outcome: 'failure',
        provider: 'github',
        statusCode: response.status,
        responseBodyLength: body.length,
      },
      'GitHub token exchange failed',
    );
    throw new AppError(502, 'GitHub token exchange failed', 'GITHUB_TOKEN_EXCHANGE_FAILED');
  }

  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!payload.access_token) {
    logger.error(
      {
        event: 'app.oauth.token_exchange_failed',
        outcome: 'failure',
        provider: 'github',
        errorCode: payload.error ?? 'missing_access_token',
      },
      'GitHub token exchange returned no access token',
    );
    throw new AppError(
      502,
      payload.error_description ?? 'GitHub token exchange failed',
      'GITHUB_TOKEN_EXCHANGE_FAILED',
    );
  }

  logger.info(
    {
      event: 'app.oauth.token_exchanged',
      outcome: 'success',
      provider: 'github',
    },
    'GitHub token exchange succeeded',
  );

  return payload.access_token;
}

export async function fetchGitHubAccount(accessToken: string) {
  const logger = getLogger({ component: 'app-service', provider: 'github' });
  const response = await fetchWithTelemetry(
    'https://api.github.com/user',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'agentic-ai-assistant',
      },
    },
    {
      component: 'app-service',
      provider: 'github',
      eventPrefix: 'app.account_lookup',
      logResponseBodyOnFailure: false,
    },
  );

  if (!response.ok) {
    logger.error(
      {
        event: 'app.account_lookup.failed',
        outcome: 'failure',
        provider: 'github',
        statusCode: response.status,
      },
      'GitHub account lookup failed',
    );
    throw new AppError(502, 'GitHub account lookup failed', 'GITHUB_ACCOUNT_LOOKUP_FAILED');
  }

  logger.info(
    {
      event: 'app.account_lookup.completed',
      outcome: 'success',
      provider: 'github',
    },
    'GitHub account lookup succeeded',
  );
  return response.json() as Promise<{ login: string; id: number }>;
}
