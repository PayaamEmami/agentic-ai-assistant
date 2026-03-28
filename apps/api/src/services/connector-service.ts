import crypto from 'node:crypto';
import {
  connectorConfigRepository,
  connectorSyncRunRepository,
  getPool,
  sourceRepository,
} from '@aaa/db';
import {
  GitHubConnector,
  encryptConnectorCredentials,
  decryptConnectorCredentials,
} from '@aaa/connectors';
import { addLogContext, fetchWithTelemetry, getLogContext, getLogger } from '@aaa/observability';
import { AppError } from '../lib/errors.js';
import { enqueueConnectorSyncJob } from './connector-queue.js';

type SupportedConnectorKind = 'github' | 'google_docs';

interface OAuthStatePayload {
  flowId: string;
  userId: string;
  kind: SupportedConnectorKind;
  issuedAt: number;
  expiresAt: number;
}

interface ConnectorSummary {
  id: string;
  kind: SupportedConnectorKind;
  status: 'pending' | 'connected' | 'failed';
  lastSyncAt: string | null;
  lastSyncStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
  lastError: string | null;
  hasCredentials: boolean;
  selectedRepoCount?: number;
  recentSyncRuns: Array<{
    id: string;
    trigger: string;
    status: 'running' | 'completed' | 'failed';
    itemsDiscovered: number;
    itemsQueued: number;
    itemsDeleted: number;
    errorCount: number;
    errorSummary: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  recentSources: Array<{
    id: string;
    kind: string;
    title: string;
    uri: string | null;
    mimeType: string | null;
    updatedAt: string;
  }>;
}

interface GitHubRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  selected: boolean;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new AppError(500, `Missing required environment variable: ${key}`, 'CONFIG_MISSING');
  }
  return value;
}

function getOAuthStateSecret(): string {
  return process.env['JWT_SECRET'] ?? 'dev-insecure-jwt-secret';
}

function signOAuthState(payload: OAuthStatePayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyOAuthState(state: string): OAuthStatePayload {
  const [encodedPayload, signature] = state.split('.');
  if (!encodedPayload || !signature) {
    throw new AppError(400, 'Invalid connector state', 'CONNECTOR_INVALID_STATE');
  }

  const expectedSignature = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(encodedPayload)
    .digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new AppError(400, 'Invalid connector state signature', 'CONNECTOR_INVALID_STATE');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as OAuthStatePayload;
  if (typeof payload.flowId !== 'string' || payload.flowId.trim().length === 0) {
    throw new AppError(400, 'Connector state is missing flow context', 'CONNECTOR_INVALID_STATE');
  }
  if (payload.expiresAt < Date.now()) {
    throw new AppError(400, 'Connector state has expired', 'CONNECTOR_STATE_EXPIRED');
  }
  if (payload.kind !== 'github' && payload.kind !== 'google_docs') {
    throw new AppError(400, 'Unsupported connector state', 'CONNECTOR_INVALID_STATE');
  }

  return payload;
}

function buildConnectorRedirect(kind: SupportedConnectorKind, status: 'connected' | 'error', message?: string): string {
  const baseUrl = process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';
  const url = new URL('/chat', baseUrl);
  url.searchParams.set('connector', kind);
  url.searchParams.set('connectorStatus', status);
  if (message) {
    url.searchParams.set('connectorMessage', message);
  }
  return url.toString();
}

async function exchangeGoogleCode(code: string) {
  const logger = getLogger({ component: 'connector-service', provider: 'google' });
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const redirectUri = requireEnv('GOOGLE_REDIRECT_URI');

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
        redirect_uri: redirectUri,
      }),
    },
    {
      component: 'connector-service',
      provider: 'google',
      eventPrefix: 'connector.oauth.token_exchange',
      logResponseBodyOnFailure: false,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error(
      {
        event: 'connector.oauth.token_exchange_failed',
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
      event: 'connector.oauth.token_exchanged',
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

async function exchangeGitHubCode(code: string) {
  const logger = getLogger({ component: 'connector-service', provider: 'github' });
  const clientId = requireEnv('GITHUB_CLIENT_ID');
  const clientSecret = requireEnv('GITHUB_CLIENT_SECRET');
  const redirectUri = requireEnv('GITHUB_REDIRECT_URI');

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
        redirect_uri: redirectUri,
      }),
    },
    {
      component: 'connector-service',
      provider: 'github',
      eventPrefix: 'connector.oauth.token_exchange',
      logResponseBodyOnFailure: false,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error(
      {
        event: 'connector.oauth.token_exchange_failed',
        outcome: 'failure',
        provider: 'github',
        statusCode: response.status,
        responseBodyLength: body.length,
      },
      'GitHub token exchange failed',
    );
    throw new AppError(502, 'GitHub token exchange failed', 'GITHUB_TOKEN_EXCHANGE_FAILED');
  }

  const result = await response.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!result.access_token) {
    logger.error(
      {
        event: 'connector.oauth.token_exchange_failed',
        outcome: 'failure',
        provider: 'github',
        errorCode: result.error ?? 'missing_access_token',
      },
      'GitHub token exchange did not return an access token',
    );
    throw new AppError(
      502,
      result.error_description ?? result.error ?? 'GitHub did not return an access token',
      'GITHUB_TOKEN_EXCHANGE_FAILED',
    );
  }
  logger.info(
    {
      event: 'connector.oauth.token_exchanged',
      outcome: 'success',
      provider: 'github',
    },
    'GitHub token exchange succeeded',
  );
  return result.access_token;
}

async function fetchGitHubAccount(accessToken: string) {
  const logger = getLogger({ component: 'connector-service', provider: 'github' });
  const response = await fetchWithTelemetry(
    'https://api.github.com/user',
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'agentic-ai-assistant',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
    {
      component: 'connector-service',
      provider: 'github',
      eventPrefix: 'connector.account_lookup',
      logResponseBodyOnFailure: false,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error(
      {
        event: 'connector.account_lookup.failed',
        outcome: 'failure',
        provider: 'github',
        statusCode: response.status,
        responseBodyLength: body.length,
      },
      'GitHub account lookup failed',
    );
    throw new AppError(502, 'GitHub account lookup failed', 'GITHUB_ACCOUNT_LOOKUP_FAILED');
  }

  logger.info(
    {
      event: 'connector.account_lookup.completed',
      outcome: 'success',
      provider: 'github',
    },
    'GitHub account lookup succeeded',
  );
  return response.json() as Promise<{ login: string; id: number }>;
}

function getSelectedRepoCount(settings: Record<string, unknown>): number | undefined {
  const selectedRepos = settings.selectedRepos;
  return Array.isArray(selectedRepos) ? selectedRepos.length : undefined;
}

async function toRecentSyncRuns(userId: string, kind: SupportedConnectorKind) {
  const runs = await connectorSyncRunRepository.listRecentByUserAndKind(userId, kind, 5);
  return runs.map((run) => ({
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    itemsDiscovered: run.itemsDiscovered,
    itemsQueued: run.itemsQueued,
    itemsDeleted: run.itemsDeleted,
    errorCount: run.errorCount,
    errorSummary: run.errorSummary,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  }));
}

async function toRecentSources(userId: string, kind: SupportedConnectorKind) {
  const sources = await sourceRepository.listIndexedByUserAndConnector(userId, kind, 8);
  return sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    title: source.title,
    uri: source.uri,
    mimeType: source.mimeType,
    updatedAt: source.updatedAt.toISOString(),
  }));
}

export class ConnectorService {
  async listConnectors(userId: string): Promise<ConnectorSummary[]> {
    const configs = await connectorConfigRepository.listByUser(userId);
    const byKind = new Map(configs.map((config) => [config.kind, config]));
    const recentRunsByKind = new Map<SupportedConnectorKind, Awaited<ReturnType<typeof toRecentSyncRuns>>>();
    const recentSourcesByKind = new Map<SupportedConnectorKind, Awaited<ReturnType<typeof toRecentSources>>>();
    for (const kind of ['google_docs', 'github'] as const) {
      const [recentRuns, recentSources] = await Promise.all([
        toRecentSyncRuns(userId, kind),
        toRecentSources(userId, kind),
      ]);
      recentRunsByKind.set(kind, recentRuns);
      recentSourcesByKind.set(kind, recentSources);
    }

    return (['google_docs', 'github'] as const).map((kind) => {
      const config = byKind.get(kind);
      return {
        id: config?.id ?? crypto.randomUUID(),
        kind,
        status: config?.status ?? 'pending',
        lastSyncAt: config?.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: config?.lastSyncStatus ?? null,
        lastError: config?.lastError ?? null,
        hasCredentials: Boolean(config?.credentialsEncrypted),
        selectedRepoCount: config ? getSelectedRepoCount(config.settings) : undefined,
        recentSyncRuns: recentRunsByKind.get(kind) ?? [],
        recentSources: recentSourcesByKind.get(kind) ?? [],
      };
    });
  }

  async createAuthorizationUrl(userId: string, kind: SupportedConnectorKind): Promise<string> {
    const flowId = crypto.randomUUID();
    const state = signOAuthState({
      flowId,
      userId,
      kind,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    getLogger({
      component: 'connector-service',
      userId,
      connectorKind: kind,
      correlationId: flowId,
    }).info(
      {
        event: 'connector.oauth.started',
        outcome: 'start',
      },
      'Connector authorization flow started',
    );

    if (kind === 'google_docs') {
      const params = new URLSearchParams({
        client_id: requireEnv('GOOGLE_CLIENT_ID'),
        redirect_uri: requireEnv('GOOGLE_REDIRECT_URI'),
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    const params = new URLSearchParams({
      client_id: requireEnv('GITHUB_CLIENT_ID'),
      redirect_uri: requireEnv('GITHUB_REDIRECT_URI'),
      scope: 'repo read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async handleGoogleCallback(code: string, state: string): Promise<string> {
    const payload = verifyOAuthState(state);
    addLogContext({
      correlationId: payload.flowId,
      userId: payload.userId,
      connectorKind: 'google_docs',
    });
    const token = await exchangeGoogleCode(code);
    const existing = await connectorConfigRepository.findByUserAndKind(payload.userId, 'google_docs');
    const credentials = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? undefined,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    };
    await connectorConfigRepository.upsert(
      payload.userId,
      'google_docs',
      'connected',
      encryptConnectorCredentials(credentials),
      existing?.settings ?? {},
    );
    getLogger({
      component: 'connector-service',
      correlationId: payload.flowId,
      userId: payload.userId,
      connectorKind: 'google_docs',
    }).info(
      {
        event: 'connector.oauth.callback_completed',
        outcome: 'success',
      },
      'Google Docs connector callback completed',
    );

    return buildConnectorRedirect('google_docs', 'connected');
  }

  async handleGitHubCallback(code: string, state: string): Promise<string> {
    const payload = verifyOAuthState(state);
    addLogContext({
      correlationId: payload.flowId,
      userId: payload.userId,
      connectorKind: 'github',
    });
    const accessToken = await exchangeGitHubCode(code);
    const account = await fetchGitHubAccount(accessToken);
    const existing = await connectorConfigRepository.findByUserAndKind(payload.userId, 'github');
    const credentials = {
      accessToken,
      accountLogin: account.login,
      accountId: account.id,
    };
    await connectorConfigRepository.upsert(
      payload.userId,
      'github',
      'connected',
      encryptConnectorCredentials(credentials),
      existing?.settings ?? {},
    );
    getLogger({
      component: 'connector-service',
      correlationId: payload.flowId,
      userId: payload.userId,
      connectorKind: 'github',
    }).info(
      {
        event: 'connector.oauth.callback_completed',
        outcome: 'success',
      },
      'GitHub connector callback completed',
    );

    return buildConnectorRedirect('github', 'connected');
  }

  async triggerSync(userId: string, kind: SupportedConnectorKind): Promise<void> {
    const config = await connectorConfigRepository.findByUserAndKind(userId, kind);
    if (!config) {
      throw new AppError(404, 'Connector is not connected', 'CONNECTOR_NOT_FOUND');
    }

    const correlationId = getLogContext().correlationId ?? crypto.randomUUID();
    await enqueueConnectorSyncJob({
      connectorConfigId: config.id,
      connectorKind: kind,
      userId,
      correlationId,
    });
    getLogger({
      component: 'connector-service',
      userId,
      connectorKind: kind,
      connectorConfigId: config.id,
      correlationId,
    }).info(
      {
        event: 'connector.sync.requested',
        outcome: 'accepted',
      },
      'Connector sync requested',
    );
  }

  async disconnect(userId: string, kind: SupportedConnectorKind): Promise<{ ok: true }> {
    const config = await connectorConfigRepository.findByUserAndKind(userId, kind);
    if (!config) {
      throw new AppError(404, 'Connector is not connected', 'CONNECTOR_NOT_FOUND');
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM sources
         WHERE user_id = $1 AND connector_kind = $2`,
        [userId, kind],
      );
      const deleteResult = await client.query(
        'DELETE FROM connector_configs WHERE id = $1',
        [config.id],
      );
      if ((deleteResult.rowCount ?? 0) === 0) {
        throw new AppError(404, 'Connector is not connected', 'CONNECTOR_NOT_FOUND');
      }
      await client.query('COMMIT');
      getLogger({
        component: 'connector-service',
        userId,
        connectorKind: kind,
        connectorConfigId: config.id,
      }).info(
        {
          event: 'connector.disconnected',
          outcome: 'success',
        },
        'Connector disconnected',
      );
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      getLogger({
        component: 'connector-service',
        userId,
        connectorKind: kind,
      }).error(
        {
          event: 'connector.disconnect_failed',
          outcome: 'failure',
          error,
        },
        'Connector disconnect failed',
      );
      throw error;
    } finally {
      client.release();
    }
  }

  async listGitHubRepositories(userId: string): Promise<GitHubRepositorySummary[]> {
    const config = await connectorConfigRepository.findByUserAndKind(userId, 'github');
    if (!config) {
      throw new AppError(404, 'GitHub connector is not connected', 'CONNECTOR_NOT_FOUND');
    }

    const connector = new GitHubConnector();
    await connector.initialize({
      kind: 'github',
      credentials: decryptConnectorCredentials(config.credentialsEncrypted),
      settings: config.settings,
    });

    const selectedIds = new Set(
      Array.isArray(config.settings.selectedRepos)
        ? config.settings.selectedRepos
            .map((repo) => (repo && typeof repo === 'object' ? (repo as Record<string, unknown>).id : null))
            .filter((id): id is number => typeof id === 'number')
        : [],
    );

    const repositories = await connector.listRepositories();
    getLogger({
      component: 'connector-service',
      userId,
      connectorKind: 'github',
      connectorConfigId: config.id,
    }).info(
      {
        event: 'connector.repositories_listed',
        outcome: 'success',
        repositoryCount: repositories.length,
      },
      'GitHub repositories listed',
    );
    return repositories.map((repo) => ({
      ...repo,
      selected: selectedIds.has(repo.id),
    }));
  }

  async saveGitHubRepositories(userId: string, repositoryIds: number[]): Promise<void> {
    const config = await connectorConfigRepository.findByUserAndKind(userId, 'github');
    if (!config) {
      throw new AppError(404, 'GitHub connector is not connected', 'CONNECTOR_NOT_FOUND');
    }

    const connector = new GitHubConnector();
    await connector.initialize({
      kind: 'github',
      credentials: decryptConnectorCredentials(config.credentialsEncrypted),
      settings: config.settings,
    });
    const repositories = await connector.listRepositories();
    const selected = repositories.filter((repo) => repositoryIds.includes(repo.id));
    await connectorConfigRepository.updateSettings(config.id, {
      ...config.settings,
      selectedRepos: selected,
    });
    getLogger({
      component: 'connector-service',
      userId,
      connectorKind: 'github',
      connectorConfigId: config.id,
    }).info(
      {
        event: 'connector.repositories_saved',
        outcome: 'success',
        selectedRepoCount: selected.length,
      },
      'GitHub repositories saved',
    );
  }
}
