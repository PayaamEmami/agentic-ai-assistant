import crypto from 'node:crypto';
import {
  appCapabilityConfigRepository,
  appSyncRunRepository,
  getPool,
  sourceRepository,
} from '@aaa/db';
import {
  GitHubKnowledgeSource,
  decryptCredentials,
  encryptCredentials,
} from '@aaa/knowledge-sources';
import { addLogContext, fetchWithTelemetry, getLogContext, getLogger } from '@aaa/observability';
import { AppError } from '../lib/errors.js';
import { enqueueAppSyncJob } from './app-queue.js';

type AppKind = 'github' | 'google';
type AppCapability = 'knowledge' | 'tools';

interface OAuthStatePayload {
  flowId: string;
  userId: string;
  appKind: AppKind;
  issuedAt: number;
  expiresAt: number;
}

interface AppCapabilitySummary {
  capability: AppCapability;
  status: 'pending' | 'connected' | 'failed';
  lastSyncAt: string | null;
  lastSyncStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
  lastError: string | null;
  hasCredentials: boolean;
  totalSourceCount: number;
  searchableSourceCount: number;
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

interface AppSummary {
  kind: AppKind;
  displayName: string;
  status: 'pending' | 'connected' | 'failed';
  hasCredentials: boolean;
  lastError: string | null;
  selectedRepoCount?: number;
  knowledge: AppCapabilitySummary;
  tools: AppCapabilitySummary;
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

function normalizeRedirectBase(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

function buildGoogleRedirectUri(): string {
  return new URL(
    'callback',
    normalizeRedirectBase(requireEnv('GOOGLE_APP_REDIRECT_URI_BASE')),
  ).toString();
}

function buildGitHubRedirectUri(): string {
  return new URL(
    'callback',
    normalizeRedirectBase(requireEnv('GITHUB_APP_REDIRECT_URI_BASE')),
  ).toString();
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
    throw new AppError(400, 'Invalid app state', 'APP_INVALID_STATE');
  }

  const expectedSignature = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(encodedPayload)
    .digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new AppError(400, 'Invalid app state signature', 'APP_INVALID_STATE');
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  ) as OAuthStatePayload;
  if (typeof payload.flowId !== 'string' || payload.flowId.trim().length === 0) {
    throw new AppError(400, 'App state is missing flow context', 'APP_INVALID_STATE');
  }
  if (payload.expiresAt < Date.now()) {
    throw new AppError(400, 'App state has expired', 'APP_STATE_EXPIRED');
  }
  if (payload.appKind !== 'github' && payload.appKind !== 'google') {
    throw new AppError(400, 'Unsupported app state', 'APP_INVALID_STATE');
  }

  return payload;
}

function appLabel(kind: AppKind): string {
  return kind === 'github' ? 'GitHub' : 'Google';
}

function buildAppRedirect(
  kind: AppKind,
  status: 'connected' | 'error',
  message?: string,
): string {
  const baseUrl = process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';
  const url = new URL('/chat/apps', baseUrl);
  url.searchParams.set('app', kind);
  url.searchParams.set('appStatus', status);
  if (message) {
    url.searchParams.set('appMessage', message);
  }
  return url.toString();
}

async function exchangeGoogleCode(code: string) {
  const logger = getLogger({ component: 'app-service', provider: 'google' });
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');

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
        redirect_uri: buildGoogleRedirectUri(),
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

async function exchangeGitHubCode(code: string) {
  const logger = getLogger({ component: 'app-service', provider: 'github' });
  const clientId = requireEnv('GITHUB_CLIENT_ID');
  const clientSecret = requireEnv('GITHUB_CLIENT_SECRET');

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
        redirect_uri: buildGitHubRedirectUri(),
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

async function fetchGitHubAccount(accessToken: string) {
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

function getSelectedRepoCount(settings: Record<string, unknown>): number | undefined {
  const selectedRepos = settings['selectedRepos'];
  return Array.isArray(selectedRepos) ? selectedRepos.length : undefined;
}

async function toRecentSyncRuns(userId: string, appKind: AppKind) {
  const runs = await appSyncRunRepository.listRecentByUserAndAppAndCapability(
    userId,
    appKind,
    'knowledge',
    5,
  );
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

async function toRecentSources(userId: string, appKind: AppKind) {
  const sources = await sourceRepository.listIndexedByUserAndApp(userId, appKind, 8);
  return sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    title: source.title,
    uri: source.uri,
    mimeType: source.mimeType,
    updatedAt: source.updatedAt.toISOString(),
  }));
}

function toCapabilitySummary(
  capability: AppCapability,
  config:
    | Awaited<ReturnType<typeof appCapabilityConfigRepository.findByUserAppAndCapability>>
    | undefined,
  sourceStats = { totalSources: 0, searchableSources: 0 },
  recentSyncRuns: Awaited<ReturnType<typeof toRecentSyncRuns>> = [],
  recentSources: Awaited<ReturnType<typeof toRecentSources>> = [],
): AppCapabilitySummary {
  return {
    capability,
    status: config?.status ?? 'pending',
    lastSyncAt: config?.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: config?.lastSyncStatus ?? null,
    lastError: config?.lastError ?? null,
    hasCredentials: Boolean(config?.encryptedCredentials),
    totalSourceCount: sourceStats.totalSources,
    searchableSourceCount: sourceStats.searchableSources,
    recentSyncRuns,
    recentSources,
  };
}

export class AppService {
  async listApps(userId: string): Promise<AppSummary[]> {
    const configs = await appCapabilityConfigRepository.listByUser(userId);
    const byKey = new Map(configs.map((config) => [`${config.appKind}:${config.capability}`, config]));

    const recentRunsByApp = new Map<AppKind, Awaited<ReturnType<typeof toRecentSyncRuns>>>();
    const recentSourcesByApp = new Map<AppKind, Awaited<ReturnType<typeof toRecentSources>>>();
    const sourceStatsByApp = new Map<
      AppKind,
      Awaited<ReturnType<typeof sourceRepository.getAppSourceStats>>
    >();

    for (const appKind of ['github', 'google'] as const) {
      const [recentRuns, recentSources, sourceStats] = await Promise.all([
        toRecentSyncRuns(userId, appKind),
        toRecentSources(userId, appKind),
        sourceRepository.getAppSourceStats(userId, appKind),
      ]);
      recentRunsByApp.set(appKind, recentRuns);
      recentSourcesByApp.set(appKind, recentSources);
      sourceStatsByApp.set(appKind, sourceStats);
    }

    return (['github', 'google'] as const).map((appKind) => {
      const knowledgeConfig = byKey.get(`${appKind}:knowledge`);
      const toolsConfig = byKey.get(`${appKind}:tools`);
      const knowledge = toCapabilitySummary(
        'knowledge',
        knowledgeConfig,
        sourceStatsByApp.get(appKind),
        recentRunsByApp.get(appKind),
        recentSourcesByApp.get(appKind),
      );
      const tools = toCapabilitySummary('tools', toolsConfig);
      const hasCredentials = knowledge.hasCredentials || tools.hasCredentials;
      const status =
        knowledge.status === 'connected' && tools.status === 'connected'
          ? 'connected'
          : knowledge.status === 'failed' || tools.status === 'failed'
            ? 'failed'
            : 'pending';
      const lastError = knowledge.lastError ?? tools.lastError ?? null;

      return {
        kind: appKind,
        displayName: appLabel(appKind),
        status,
        hasCredentials,
        lastError,
        selectedRepoCount:
          appKind === 'github' && knowledgeConfig
            ? getSelectedRepoCount(knowledgeConfig.settings)
            : undefined,
        knowledge,
        tools,
      };
    });
  }

  async createAuthorizationUrl(userId: string, appKind: AppKind): Promise<string> {
    const flowId = crypto.randomUUID();
    const state = signOAuthState({
      flowId,
      userId,
      appKind,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    getLogger({
      component: 'app-service',
      userId,
      appKind,
      correlationId: flowId,
    }).info(
      {
        event: 'app.oauth.started',
        outcome: 'start',
      },
      'App authorization flow started',
    );

    if (appKind === 'google') {
      const params = new URLSearchParams({
        client_id: requireEnv('GOOGLE_CLIENT_ID'),
        redirect_uri: buildGoogleRedirectUri(),
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/documents',
        ].join(' '),
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    const params = new URLSearchParams({
      client_id: requireEnv('GITHUB_CLIENT_ID'),
      redirect_uri: buildGitHubRedirectUri(),
      scope: 'repo workflow read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async handleGoogleCallback(code: string, state: string): Promise<string> {
    const payload = verifyOAuthState(state);
    addLogContext({
      correlationId: payload.flowId,
      userId: payload.userId,
      appKind: 'google',
    });

    const token = await exchangeGoogleCode(code);
    const credentials = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? undefined,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    };
    const encryptedCredentials = encryptCredentials(credentials);
    const existingKnowledge = await appCapabilityConfigRepository.findByUserAppAndCapability(
      payload.userId,
      'google',
      'knowledge',
    );
    const existingTools = await appCapabilityConfigRepository.findByUserAppAndCapability(
      payload.userId,
      'google',
      'tools',
    );

    await Promise.all([
      appCapabilityConfigRepository.upsert(
        payload.userId,
        'google',
        'knowledge',
        'connected',
        encryptedCredentials,
        existingKnowledge?.settings ?? {},
      ),
      appCapabilityConfigRepository.upsert(
        payload.userId,
        'google',
        'tools',
        'connected',
        encryptedCredentials,
        existingTools?.settings ?? {},
      ),
    ]);

    getLogger({
      component: 'app-service',
      correlationId: payload.flowId,
      userId: payload.userId,
      appKind: 'google',
    }).info(
      {
        event: 'app.oauth.callback_completed',
        outcome: 'success',
      },
      'Google app callback completed',
    );

    return buildAppRedirect('google', 'connected');
  }

  async handleGitHubCallback(code: string, state: string): Promise<string> {
    const payload = verifyOAuthState(state);
    addLogContext({
      correlationId: payload.flowId,
      userId: payload.userId,
      appKind: 'github',
    });

    const accessToken = await exchangeGitHubCode(code);
    const account = await fetchGitHubAccount(accessToken);
    const credentials = {
      accessToken,
      accountLogin: account.login,
      accountId: account.id,
    };
    const encryptedCredentials = encryptCredentials(credentials);
    const existingKnowledge = await appCapabilityConfigRepository.findByUserAppAndCapability(
      payload.userId,
      'github',
      'knowledge',
    );
    const existingTools = await appCapabilityConfigRepository.findByUserAppAndCapability(
      payload.userId,
      'github',
      'tools',
    );

    await Promise.all([
      appCapabilityConfigRepository.upsert(
        payload.userId,
        'github',
        'knowledge',
        'connected',
        encryptedCredentials,
        existingKnowledge?.settings ?? {},
      ),
      appCapabilityConfigRepository.upsert(
        payload.userId,
        'github',
        'tools',
        'connected',
        encryptedCredentials,
        existingTools?.settings ?? {},
      ),
    ]);

    getLogger({
      component: 'app-service',
      correlationId: payload.flowId,
      userId: payload.userId,
      appKind: 'github',
    }).info(
      {
        event: 'app.oauth.callback_completed',
        outcome: 'success',
      },
      'GitHub app callback completed',
    );

    return buildAppRedirect('github', 'connected');
  }

  async triggerSync(userId: string, appKind: AppKind): Promise<void> {
    const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
      userId,
      appKind,
      'knowledge',
    );
    if (!config) {
      throw new AppError(404, 'App is not connected', 'APP_NOT_FOUND');
    }

    const correlationId = getLogContext().correlationId ?? crypto.randomUUID();
    await enqueueAppSyncJob({
      appCapabilityConfigId: config.id,
      appKind,
      capability: 'knowledge',
      userId,
      correlationId,
    });
    getLogger({
      component: 'app-service',
      userId,
      appKind,
      appCapability: 'knowledge',
      appCapabilityConfigId: config.id,
      correlationId,
    }).info(
      {
        event: 'app.sync.requested',
        outcome: 'accepted',
      },
      'App sync requested',
    );
  }

  async disconnect(userId: string, appKind: AppKind): Promise<{ ok: true }> {
    const configs = await appCapabilityConfigRepository.listByUserAndApp(userId, appKind);
    if (configs.length === 0) {
      throw new AppError(404, 'App is not connected', 'APP_NOT_FOUND');
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM sources
         WHERE user_id = $1 AND app_kind = $2`,
        [userId, appKind],
      );
      await client.query(
        `DELETE FROM app_capability_configs
         WHERE user_id = $1 AND app_kind = $2`,
        [userId, appKind],
      );
      await client.query('COMMIT');

      getLogger({
        component: 'app-service',
        userId,
        appKind,
      }).info(
        {
          event: 'app.disconnected',
          outcome: 'success',
        },
        'App disconnected',
      );
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      getLogger({
        component: 'app-service',
        userId,
        appKind,
      }).error(
        {
          event: 'app.disconnect_failed',
          outcome: 'failure',
          error,
        },
        'App disconnect failed',
      );
      throw error;
    } finally {
      client.release();
    }
  }

  async listGitHubRepositories(userId: string): Promise<GitHubRepositorySummary[]> {
    const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
      userId,
      'github',
      'knowledge',
    );
    if (!config) {
      throw new AppError(404, 'GitHub app is not connected', 'APP_NOT_FOUND');
    }

    const source = new GitHubKnowledgeSource();
    await source.initialize({
      kind: 'github',
      credentials: decryptCredentials(config.encryptedCredentials),
      settings: config.settings,
    });

    const selectedIds = new Set(
      Array.isArray(config.settings['selectedRepos'])
        ? config.settings['selectedRepos']
            .map((repo) =>
              repo && typeof repo === 'object' ? (repo as Record<string, unknown>)['id'] : null,
            )
            .filter((id): id is number => typeof id === 'number')
        : [],
    );

    const repositories = await source.listRepositories();
    getLogger({
      component: 'app-service',
      userId,
      appKind: 'github',
      appCapability: 'knowledge',
      appCapabilityConfigId: config.id,
    }).info(
      {
        event: 'app.repositories_listed',
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
    const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
      userId,
      'github',
      'knowledge',
    );
    if (!config) {
      throw new AppError(404, 'GitHub app is not connected', 'APP_NOT_FOUND');
    }

    const source = new GitHubKnowledgeSource();
    await source.initialize({
      kind: 'github',
      credentials: decryptCredentials(config.encryptedCredentials),
      settings: config.settings,
    });

    const repositories = await source.listRepositories();
    const selected = repositories.filter((repo) => repositoryIds.includes(repo.id));
    await appCapabilityConfigRepository.updateSettings(config.id, {
      ...config.settings,
      selectedRepos: selected,
    });

    getLogger({
      component: 'app-service',
      userId,
      appKind: 'github',
      appCapability: 'knowledge',
      appCapabilityConfigId: config.id,
    }).info(
      {
        event: 'app.repositories_saved',
        outcome: 'success',
        selectedRepoCount: selected.length,
      },
      'GitHub repositories saved',
    );
  }
}
