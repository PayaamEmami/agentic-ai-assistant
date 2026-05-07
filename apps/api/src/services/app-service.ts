import crypto from 'node:crypto';
import { appCapabilityConfigRepository } from '@aaa/db';
import {
  GitHubKnowledgeSource,
  decryptCredentials,
  encryptCredentials,
} from '@aaa/knowledge-sources';
import { addLogContext, getLogContext, getLogger } from '@aaa/observability';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { type EnqueueAppSyncJob, enqueueAppSyncJob as defaultEnqueueAppSyncJob } from './app-queue.js';
import {
  buildGitHubRedirectUri,
  buildGoogleRedirectUri,
  requireEnv,
  signOAuthState,
  verifyOAuthState,
} from './app-oauth-state.js';
import { exchangeGitHubCode, exchangeGoogleCode, fetchGitHubAccount } from './app-provider-clients.js';
import type { AppKind, AppSummary, GitHubRepositorySummary } from './app-service-types.js';
import { listAppSummaries } from './app-summaries.js';

function buildAppRedirect(
  kind: AppKind,
  status: 'connected' | 'error',
  message?: string,
  config?: AppConfig,
): string {
  const baseUrl = config?.webBaseUrl ?? 'http://localhost:3000';
  const url = new URL('/chat/apps', baseUrl);
  url.searchParams.set('app', kind);
  url.searchParams.set('appStatus', status);
  if (message) {
    url.searchParams.set('appMessage', message);
  }
  return url.toString();
}

export class AppService {
  private readonly config: AppConfig;
  private readonly enqueueAppSyncJob: EnqueueAppSyncJob;

  constructor(config: AppConfig, options?: { enqueueAppSyncJob?: EnqueueAppSyncJob }) {
    this.config = config;
    this.enqueueAppSyncJob = options?.enqueueAppSyncJob ?? defaultEnqueueAppSyncJob;
  }

  async listApps(userId: string): Promise<AppSummary[]> {
    return listAppSummaries(userId);
  }

  async createAuthorizationUrl(userId: string, appKind: AppKind): Promise<string> {
    const flowId = crypto.randomUUID();
    const state = signOAuthState(
      {
        flowId,
        userId,
        appKind,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
      },
      this.config,
    );

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
        client_id: requireEnv('GOOGLE_CLIENT_ID', this.config.googleClientId),
        redirect_uri: buildGoogleRedirectUri(this.config),
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
      client_id: requireEnv('GITHUB_CLIENT_ID', this.config.githubClientId),
      redirect_uri: buildGitHubRedirectUri(this.config),
      scope: 'repo workflow read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async handleGoogleCallback(code: string, state: string): Promise<string> {
    const payload = verifyOAuthState(state, this.config);
    addLogContext({
      correlationId: payload.flowId,
      userId: payload.userId,
      appKind: 'google',
    });

    const token = await exchangeGoogleCode(code, this.config);
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

    return buildAppRedirect('google', 'connected', undefined, this.config);
  }

  async handleGitHubCallback(code: string, state: string): Promise<string> {
    const payload = verifyOAuthState(state, this.config);
    addLogContext({
      correlationId: payload.flowId,
      userId: payload.userId,
      appKind: 'github',
    });

    const accessToken = await exchangeGitHubCode(code, this.config);
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

    return buildAppRedirect('github', 'connected', undefined, this.config);
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
    await this.enqueueAppSyncJob({
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

    try {
      await appCapabilityConfigRepository.disconnectApp(userId, appKind);

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

    await this.enqueueAppSyncJob({
      appCapabilityConfigId: config.id,
      appKind: 'github',
      capability: 'knowledge',
      userId,
      correlationId: getLogContext().correlationId ?? crypto.randomUUID(),
    });
  }
}
