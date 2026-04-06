import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  InternalPlaywrightExecuteRequest,
  McpBrowserSessionCreateRequest,
  McpBrowserSessionPersistRequest,
  McpConnectionCreateRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../lib/errors.js';
import { McpService } from '../services/mcp-service.js';
import { internalPlaywrightRpcDurationMs } from '../lib/telemetry.js';

function getInternalServiceSecret(): string {
  return process.env['INTERNAL_SERVICE_SECRET'] ?? 'dev-internal-service-secret';
}

async function authenticateInternal(request: FastifyRequest): Promise<void> {
  const header = request.headers['x-internal-service-secret'];
  const provided = typeof header === 'string' ? header : Array.isArray(header) ? header[0] : null;
  if (!provided) {
    throw new AppError(401, 'Internal authentication required', 'INTERNAL_AUTH_REQUIRED');
  }

  const expected = getInternalServiceSecret();
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new AppError(403, 'Internal authentication failed', 'INTERNAL_AUTH_INVALID');
  }
}

export async function mcpRoutes(app: FastifyInstance) {
  const mcpService = new McpService();

  app.get('/mcp/catalog', { preHandler: authenticate }, async (_request, reply) => {
    return reply.status(200).send({ integrations: mcpService.listCatalog() });
  });

  app.get('/mcp/connections', { preHandler: authenticate }, async (request, reply) => {
    const connections = await mcpService.listConnections(request.user!.id);
    return reply.status(200).send({ connections });
  });

  app.post('/mcp/connections', { preHandler: authenticate }, async (request, reply) => {
    const parsed = McpConnectionCreateRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const connection = await mcpService.createConnection(request.user!.id, parsed.data);
    return reply.status(200).send({ connection });
  });

  app.post<{ Params: { id: string } }>(
    '/mcp/connections/:id/default',
    { preHandler: authenticate },
    async (request, reply) => {
      const connection = await mcpService.setDefaultConnection(request.user!.id, request.params.id);
      return reply.status(200).send({ ok: true, connection });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/mcp/connections/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = await mcpService.deleteConnection(request.user!.id, request.params.id);
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
    '/mcp/connections/:id/browser-sessions',
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
      const result = await mcpService.executePlaywrightTool(parsed.data.userId, parsed.data.mcpConnectionId, {
        toolName: parsed.data.toolName,
        arguments: parsed.data.input,
      });
      internalPlaywrightRpcDurationMs.observe(
        { outcome: result.success ? 'success' : 'failure' },
        Date.now() - startedAt,
      );

      return reply.status(200).send(result);
    },
  );
}
