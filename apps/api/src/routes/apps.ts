import type { FastifyInstance } from 'fastify';
import { getLogger } from '@aaa/observability';
import { AppKindDto, GitHubRepoSelectionRequest } from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { AppService } from '../services/app-service.js';

interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

interface AppRouteOptions {
  appService?: AppService;
  webBaseUrl?: string;
}

export async function appRoutes(app: FastifyInstance, options: AppRouteOptions = {}) {
  const appService = options.appService ?? new AppService();
  const logger = getLogger({ component: 'app-routes' });
  const webBaseUrl = options.webBaseUrl ?? process.env.WEB_BASE_URL ?? 'http://localhost:3000';

  function buildErrorRedirect(kind: string, message: string): string {
    return (
      webBaseUrl +
      `/chat/apps?app=${kind}&appStatus=error&appMessage=${encodeURIComponent(message)}`
    );
  }

  async function handleOAuthCallback(
    query: OAuthCallbackQuery,
    kind: 'github' | 'google',
    handler: (code: string, state: string) => Promise<string>,
    fallbackMessage: string,
  ): Promise<string> {
    if (query.error) {
      logger.warn(
        {
          event: 'app.oauth.callback_failed',
          outcome: 'failure',
          appKind: kind,
          reason: query.error,
        },
        `${kind} callback returned an error`,
      );
      return buildErrorRedirect(kind, query.error);
    }

    if (!query.code || !query.state) {
      logger.warn(
        {
          event: 'app.oauth.callback_failed',
          outcome: 'failure',
          appKind: kind,
          reason: 'missing_callback_parameters',
        },
        `${kind} callback missing required parameters`,
      );
      return buildErrorRedirect(kind, 'Missing callback parameters');
    }

    try {
      return await handler(query.code, query.state);
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackMessage;
      logger.error(
        {
          event: 'app.oauth.callback_failed',
          outcome: 'failure',
          appKind: kind,
          error,
        },
        `${kind} callback failed`,
      );
      return buildErrorRedirect(kind, message);
    }
  }

  app.get('/apps/github/callback', async (request, reply) => {
    const redirectUrl = await handleOAuthCallback(
      request.query as OAuthCallbackQuery,
      'github',
      (code, state) => appService.handleGitHubCallback(code, state),
      'GitHub app connection failed',
    );
    return reply.redirect(redirectUrl);
  });

  app.get('/apps/google/callback', async (request, reply) => {
    const redirectUrl = await handleOAuthCallback(
      request.query as OAuthCallbackQuery,
      'google',
      (code, state) => appService.handleGoogleCallback(code, state),
      'Google app connection failed',
    );
    return reply.redirect(redirectUrl);
  });

  app.get('/apps', { preHandler: authenticate }, async (request, reply) => {
    const apps = await appService.listApps(request.user!.id);
    return reply.status(200).send({ apps });
  });

  app.post<{ Params: { kind: 'github' | 'google' } }>(
    '/apps/:kind/connect',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = AppKindDto.safeParse(request.params.kind);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const authorizationUrl = await appService.createAuthorizationUrl(
        request.user!.id,
        parsed.data,
      );
      return reply.status(200).send({ authorizationUrl });
    },
  );

  app.post<{ Params: { kind: 'github' | 'google' } }>(
    '/apps/:kind/sync',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = AppKindDto.safeParse(request.params.kind);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      await appService.triggerSync(request.user!.id, parsed.data);
      return reply.status(200).send({ queued: true });
    },
  );

  app.delete<{ Params: { kind: 'github' | 'google' } }>(
    '/apps/:kind',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = AppKindDto.safeParse(request.params.kind);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const result = await appService.disconnect(request.user!.id, parsed.data);
      return reply.status(200).send(result);
    },
  );

  app.get('/apps/github/repositories', { preHandler: authenticate }, async (request, reply) => {
    const repositories = await appService.listGitHubRepositories(request.user!.id);
    return reply.status(200).send({ repositories });
  });

  app.put('/apps/github/repositories', { preHandler: authenticate }, async (request, reply) => {
    const parsed = GitHubRepoSelectionRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    await appService.saveGitHubRepositories(request.user!.id, parsed.data.repositoryIds);
    return reply.status(200).send({ ok: true });
  });
}
