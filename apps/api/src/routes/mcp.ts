import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  InternalPlaywrightExecuteRequest,
  McpBrowserSessionCreateRequest,
  McpBrowserSessionPersistRequest,
  McpProfileCreateRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { assertInternalServiceSecret } from '../lib/internal-service.js';
import { McpService } from '../services/mcp-service.js';
import { internalPlaywrightRpcDurationMs } from '../lib/telemetry.js';

async function authenticateInternal(request: FastifyRequest): Promise<void> {
  const header = request.headers['x-internal-service-secret'];
  const provided =
    typeof header === 'string'
      ? header
      : Array.isArray(header)
        ? (header[0] ?? null)
        : null;
  assertInternalServiceSecret(provided);
}

export async function mcpRoutes(app: FastifyInstance) {
  const mcpService = new McpService();

  app.get('/mcp/catalog', { preHandler: authenticate }, async (_request, reply) => {
    return reply.status(200).send({ integrations: mcpService.listCatalog() });
  });

  app.get('/mcp/profiles', { preHandler: authenticate }, async (request, reply) => {
    const profiles = await mcpService.listProfiles(request.user!.id);
    return reply.status(200).send({ profiles });
  });

  app.post('/mcp/profiles', { preHandler: authenticate }, async (request, reply) => {
    const parsed = McpProfileCreateRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const profile = await mcpService.createProfile(request.user!.id, parsed.data);
    return reply.status(200).send({ profile });
  });

  app.post<{ Params: { id: string } }>(
    '/mcp/profiles/:id/default',
    { preHandler: authenticate },
    async (request, reply) => {
      const profile = await mcpService.setDefaultProfile(request.user!.id, request.params.id);
      return reply.status(200).send({ ok: true, profile });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/mcp/profiles/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = await mcpService.deleteProfile(request.user!.id, request.params.id);
      return reply.status(200).send(result);
    },
  );

  app.get<{
    Querystring: {
      conversationId?: string;
      includeEnded?: string;
      limit?: string;
    };
  }>('/mcp/browser-sessions', { preHandler: authenticate }, async (request, reply) => {
    const rawLimit =
      typeof request.query.limit === 'string' ? Number.parseInt(request.query.limit, 10) : null;
    const sessions = await mcpService.listBrowserSessionsByFilter(request.user!.id, {
      conversationId:
        typeof request.query.conversationId === 'string' &&
        request.query.conversationId.trim().length > 0
          ? request.query.conversationId.trim()
          : undefined,
      includeEnded: request.query.includeEnded === 'true',
      limit:
        rawLimit && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, 50)
          : undefined,
    });
    return reply.status(200).send({ sessions });
  });

  app.post<{ Params: { id: string } }>(
    '/mcp/profiles/:id/browser-sessions',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = McpBrowserSessionCreateRequest.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const result = await mcpService.createBrowserSession(
        request.user!.id,
        request.params.id,
        parsed.data,
      );
      return reply.status(200).send(result);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/mcp/browser-sessions/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = await mcpService.getBrowserSession(request.user!.id, request.params.id);
      return reply.status(200).send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mcp/browser-sessions/:id/persist',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = McpBrowserSessionPersistRequest.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const result = await mcpService.persistBrowserSession(
        request.user!.id,
        request.params.id,
        parsed.data,
      );
      return reply.status(200).send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mcp/browser-sessions/:id/cancel',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = await mcpService.cancelBrowserSession(request.user!.id, request.params.id);
      return reply.status(200).send(result);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/mcp/internal/browser-sessions/:id',
    async (request, reply) => {
      await authenticateInternal(request);
      const result = await mcpService.getBrowserSessionInternal(request.params.id);
      return reply.status(200).send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mcp/internal/browser-sessions/:id/persist',
    async (request, reply) => {
      await authenticateInternal(request);
      const parsed = McpBrowserSessionPersistRequest.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const result = await mcpService.persistBrowserSessionInternal(
        request.params.id,
        parsed.data,
      );
      return reply.status(200).send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mcp/internal/browser-sessions/:id/cancel',
    async (request, reply) => {
      await authenticateInternal(request);
      const result = await mcpService.cancelBrowserSessionInternal(request.params.id);
      return reply.status(200).send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mcp/internal/browser-sessions/:id/execute-tool',
    async (request, reply) => {
      await authenticateInternal(request);
      const body = request.body as { toolName?: unknown; input?: unknown } | null;
      if (
        !body ||
        typeof body.toolName !== 'string' ||
        body.toolName.trim().length === 0 ||
        !body.input ||
        typeof body.input !== 'object' ||
        Array.isArray(body.input)
      ) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'toolName and input are required' },
        });
      }

      const result = await mcpService.executePlaywrightToolInBrowserSessionInternal(
        request.params.id,
        {
          toolName: body.toolName,
          arguments: body.input as Record<string, unknown>,
        },
      );
      return reply.status(200).send(result);
    },
  );

  app.post(
    '/mcp/internal/playwright/execute',
    async (request, reply) => {
      await authenticateInternal(request);

      const parsed = InternalPlaywrightExecuteRequest.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const startedAt = Date.now();
      const result = await mcpService.executePlaywrightTool(
        parsed.data.userId,
        parsed.data.mcpProfileId,
        {
          toolName: parsed.data.toolName,
          arguments: parsed.data.input,
          conversationId: parsed.data.conversationId,
          toolExecutionId: parsed.data.toolExecutionId,
        },
      );
      internalPlaywrightRpcDurationMs.observe(
        { outcome: result.success ? 'success' : 'failure' },
        Date.now() - startedAt,
      );

      return reply.status(200).send(result);
    },
  );
}
