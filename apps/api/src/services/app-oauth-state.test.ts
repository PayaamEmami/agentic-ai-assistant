import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import { signOAuthState, verifyOAuthState } from './app-oauth-state.js';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 3001,
  nodeEnv: 'test',
  logLevel: 'info',
  logFormat: 'pretty',
  databaseUrl: 'postgres://localhost/db',
  databasePoolSize: 1,
  redisUrl: 'redis://localhost:6379',
  openaiApiKey: 'openai-key',
  openaiModel: 'gpt-test',
  openaiEmbeddingModel: 'embedding-test',
  openaiRealtimeModel: 'realtime-test',
  openaiRealtimeVoice: 'verse',
  jwtSecret: 'state-secret',
  internalServiceSecret: 'internal-secret',
  apiInstanceId: 'api-1',
  apiInternalBaseUrl: 'http://127.0.0.1:3001',
  s3Bucket: 'bucket',
  s3Region: 'us-east-1',
  s3Endpoint: undefined,
  s3AccessKeyId: undefined,
  s3SecretAccessKey: undefined,
  webBaseUrl: 'http://localhost:3000',
  appCredentialsSecret: 'credential-secret',
  googleClientId: 'google-client',
  googleClientSecret: 'google-secret',
  googleAppRedirectUriBase: 'http://localhost:3001/apps/google/',
  githubClientId: 'github-client',
  githubClientSecret: 'github-secret',
  githubAppRedirectUriBase: 'http://localhost:3001/apps/github/',
};

describe('OAuth state helpers', () => {
  it('round-trips valid signed state', () => {
    const payload = {
      flowId: 'flow-1',
      userId: 'user-1',
      appKind: 'github' as const,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };

    expect(verifyOAuthState(signOAuthState(payload, config), config)).toEqual(payload);
  });

  it('rejects malformed and wrong-length signatures with controlled AppErrors', () => {
    const state = signOAuthState(
      {
        flowId: 'flow-1',
        userId: 'user-1',
        appKind: 'google',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      config,
    );
    const [payload] = state.split('.');

    expect(() => verifyOAuthState(`${payload}.short`, config)).toThrow(
      expect.objectContaining({
        statusCode: 400,
        code: 'APP_INVALID_STATE',
      }),
    );
  });

  it('rejects expired and unsupported app-kind payloads', () => {
    const expired = signOAuthState(
      {
        flowId: 'flow-1',
        userId: 'user-1',
        appKind: 'github',
        issuedAt: Date.now() - 120_000,
        expiresAt: Date.now() - 60_000,
      },
      config,
    );

    expect(() => verifyOAuthState(expired, config)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'APP_STATE_EXPIRED' }),
    );

    const invalidAppKind = signOAuthState(
      {
        flowId: 'flow-1',
        userId: 'user-1',
        appKind: 'slack',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      } as never,
      config,
    );

    expect(() => verifyOAuthState(invalidAppKind, config)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'APP_INVALID_STATE' }),
    );
  });
});
