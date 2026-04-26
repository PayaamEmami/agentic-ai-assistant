import type { FastifyInstance } from 'fastify';
import { McpProfileCreateRequest } from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { McpService } from '../services/mcp-service.js';

interface McpRouteOptions {
  mcpService?: McpService;
}

export async function mcpRoutes(app: FastifyInstance, options: McpRouteOptions = {}) {
  const mcpService = options.mcpService ?? new McpService();

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
}
