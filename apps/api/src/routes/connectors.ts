import type { FastifyInstance } from 'fastify';
import { getLogger } from '@aaa/observability';
import {
  ConnectorKindDto,
  GitHubRepoSelectionRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { ConnectorService } from '../services/connector-service.js';

export async function connectorRoutes(app: FastifyInstance) {
  const connectorService = new ConnectorService();
  const logger = getLogger({ component: 'connector-routes' });
  const webBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

  app.get('/connectors/google-docs/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    if (query.error) {
      logger.warn(
        {
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: 'google_docs',
          reason: query.error,
        },
        'Google Docs callback returned an error',
      );
      return reply.redirect(
        webBaseUrl +
          `/chat/connectors?connector=google_docs&connectorStatus=error&connectorMessage=${encodeURIComponent(query.error)}`,
      );
    }

    if (!query.code || !query.state) {
      logger.warn(
        {
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: 'google_docs',
          reason: 'missing_callback_parameters',
        },
        'Google Docs callback missing required parameters',
      );
      return reply.redirect(
        webBaseUrl +
          '/chat/connectors?connector=google_docs&connectorStatus=error&connectorMessage=Missing%20callback%20parameters',
      );
    }

    try {
      const redirectUrl = await connectorService.handleGoogleCallback(query.code, query.state);
      return reply.redirect(redirectUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google Docs connection failed';
      logger.error(
        {
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: 'google_docs',
          error,
        },
        'Google Docs callback failed',
      );
      return reply.redirect(
        webBaseUrl +
          `/chat/connectors?connector=google_docs&connectorStatus=error&connectorMessage=${encodeURIComponent(message)}`,
      );
    }
  });

  app.get('/connectors/github/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    if (query.error) {
      logger.warn(
        {
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: 'github',
          reason: query.error,
        },
        'GitHub callback returned an error',
      );
      return reply.redirect(
        webBaseUrl +
          `/chat/connectors?connector=github&connectorStatus=error&connectorMessage=${encodeURIComponent(query.error)}`,
      );
    }

    if (!query.code || !query.state) {
      logger.warn(
        {
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: 'github',
          reason: 'missing_callback_parameters',
        },
        'GitHub callback missing required parameters',
      );
      return reply.redirect(
        webBaseUrl +
          '/chat/connectors?connector=github&connectorStatus=error&connectorMessage=Missing%20callback%20parameters',
      );
    }

    try {
      const redirectUrl = await connectorService.handleGitHubCallback(query.code, query.state);
      return reply.redirect(redirectUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GitHub connection failed';
      logger.error(
        {
          event: 'connector.oauth.callback_failed',
          outcome: 'failure',
          connectorKind: 'github',
          error,
        },
        'GitHub callback failed',
      );
      return reply.redirect(
        webBaseUrl +
          `/chat/connectors?connector=github&connectorStatus=error&connectorMessage=${encodeURIComponent(message)}`,
      );
    }
  });

  app.get('/connectors', { preHandler: authenticate }, async (request, reply) => {
    const connectors = await connectorService.listConnectors(request.user!.id);
    return reply.status(200).send({ connectors });
  });

  app.post<{ Params: { kind: 'github' | 'google_docs' } }>(
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

  app.post<{ Params: { kind: 'github' | 'google_docs' } }>(
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

  app.delete<{ Params: { kind: 'github' | 'google_docs' } }>(
    '/connectors/:kind',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = ConnectorKindDto.safeParse(request.params.kind);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const result = await connectorService.disconnect(request.user!.id, parsed.data);
      return reply.status(200).send(result);
    },
  );

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
