import type { FastifyInstance } from 'fastify';
import { getLogger } from '@aaa/observability';
import { ConnectorKindDto, GitHubRepoSelectionRequest } from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { ConnectorService } from '../services/connector-service.js';

interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

export async function connectorRoutes(app: FastifyInstance) {
  const connectorService = new ConnectorService();
  const logger = getLogger({ component: 'connector-routes' });
  const webBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

  function buildErrorRedirect(kind: string, message: string): string {
    return (
      webBaseUrl +
      `/chat/connectors?connector=${kind}&connectorStatus=error&connectorMessage=${encodeURIComponent(message)}`
    );
  }

  async function handleOAuthCallback(
    query: OAuthCallbackQuery,
    kind: 'github' | 'github_tools' | 'google_docs' | 'google_drive_tools',
    handler: (code: string, state: string) => Promise<string>,
    fallbackMessage: string,
  ): Promise<string> {
    if (query.error) {
      logger.warn(
        {
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: kind,
          reason: query.error,
        },
        `${kind} callback returned an error`,
      );
      return buildErrorRedirect(kind, query.error);
    }

    if (!query.code || !query.state) {
      logger.warn(
        {
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: kind,
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
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: kind,
          error,
        },
        `${kind} callback failed`,
      );
      return buildErrorRedirect(kind, message);
    }
  }

  app.get('/connectors/google/docs/callback', async (request, reply) => {
    const redirectUrl = await handleOAuthCallback(
      request.query as OAuthCallbackQuery,
      'google_docs',
      (code, state) => connectorService.handleGoogleCallback(code, state),
      'Google Docs connection failed',
    );
    return reply.redirect(redirectUrl);
  });

  app.get('/connectors/google/drive-tools/callback', async (request, reply) => {
    const redirectUrl = await handleOAuthCallback(
      request.query as OAuthCallbackQuery,
      'google_drive_tools',
      (code, state) => connectorService.handleGoogleDriveToolsCallback(code, state),
      'Google Drive tools connection failed',
    );
    return reply.redirect(redirectUrl);
  });

  app.get('/connectors/github/rag/callback', async (request, reply) => {
    const redirectUrl = await handleOAuthCallback(
      request.query as OAuthCallbackQuery,
      'github',
      (code, state) => connectorService.handleGitHubCallback(code, state),
      'GitHub connection failed',
    );
    return reply.redirect(redirectUrl);
  });

  app.get('/connectors/github/tools/callback', async (request, reply) => {
    const redirectUrl = await handleOAuthCallback(
      request.query as OAuthCallbackQuery,
      'github_tools',
      (code, state) => connectorService.handleGitHubToolsCallback(code, state),
      'GitHub tools connection failed',
    );
    return reply.redirect(redirectUrl);
  });

  app.get('/connectors/google-docs/callback', async (request, reply) => {
    const redirectUrl = await handleOAuthCallback(
      request.query as OAuthCallbackQuery,
      'google_docs',
      (code, state) => connectorService.handleGoogleCallback(code, state),
      'Google Docs connection failed',
    );
    return reply.redirect(redirectUrl);
  });

  app.get('/connectors/github/callback', async (request, reply) => {
    const redirectUrl = await handleOAuthCallback(
      request.query as OAuthCallbackQuery,
      'github',
      (code, state) => connectorService.handleGitHubCallback(code, state),
      'GitHub connection failed',
    );
    return reply.redirect(redirectUrl);
  });

  app.get('/connectors', { preHandler: authenticate }, async (request, reply) => {
    const connectors = await connectorService.listConnectors(request.user!.id);
    return reply.status(200).send({ connectors });
  });

  app.post<{ Params: { kind: 'github' | 'google_docs' | 'github_tools' | 'google_drive_tools' } }>(
    '/connectors/:kind/start',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = ConnectorKindDto.safeParse(request.params.kind);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const authorizationUrl = await connectorService.createAuthorizationUrl(
        request.user!.id,
        parsed.data,
      );
      return reply.status(200).send({ authorizationUrl });
    },
  );

  app.post<{ Params: { kind: 'github' | 'google_docs' | 'github_tools' | 'google_drive_tools' } }>(
    '/connectors/:kind/sync',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = ConnectorKindDto.safeParse(request.params.kind);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      await connectorService.triggerSync(request.user!.id, parsed.data);
      return reply.status(200).send({ queued: true });
    },
  );

  app.delete<{
    Params: { kind: 'github' | 'google_docs' | 'github_tools' | 'google_drive_tools' };
  }>('/connectors/:kind', { preHandler: authenticate }, async (request, reply) => {
    const parsed = ConnectorKindDto.safeParse(request.params.kind);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const result = await connectorService.disconnect(request.user!.id, parsed.data);
    return reply.status(200).send(result);
  });

  app.get('/connectors/github/repos', { preHandler: authenticate }, async (request, reply) => {
    const repositories = await connectorService.listGitHubRepositories(request.user!.id);
    return reply.status(200).send({ repositories });
  });

  app.post('/connectors/github/repos', { preHandler: authenticate }, async (request, reply) => {
    const parsed = GitHubRepoSelectionRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    await connectorService.saveGitHubRepositories(request.user!.id, parsed.data.repositoryIds);
    return reply.status(200).send({ ok: true });
  });
}
