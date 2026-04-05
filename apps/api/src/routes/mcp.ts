import type { FastifyInstance } from 'fastify';
import {
  McpAuthSessionCompleteRequest,
  McpAuthSessionCreateRequest,
  McpConnectionCreateRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { McpService } from '../services/mcp-service.js';

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

  app.post<{ Params: { id: string } }>(
    '/mcp/connections/:id/auth-sessions',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = McpAuthSessionCreateRequest.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const authSession = await mcpService.startAuthSession(request.user!.id, request.params.id);
      return reply.status(200).send({ authSession });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/mcp/auth-sessions/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const authSession = await mcpService.getAuthSession(request.user!.id, request.params.id);
      return reply.status(200).send({ authSession });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mcp/auth-sessions/:id/complete',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = McpAuthSessionCompleteRequest.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const result = await mcpService.completeAuthSession(
        request.user!.id,
        request.params.id,
        parsed.data,
      );
      return reply.status(200).send(result);
    },
  );
}
