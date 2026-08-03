import type { FastifyInstance } from 'fastify';
import {
  ListenerExplainRequest,
  ListenerSessionRequest,
  ListenerTranscriptRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import type { ListenerService } from '../services/listener/index.js';

interface ListenerRouteOptions {
  listenerService: ListenerService;
}

export async function listenerRoutes(app: FastifyInstance, options: ListenerRouteOptions) {
  const { listenerService } = options;
  app.addHook('preHandler', authenticate);

  app.post('/listener/session', async (request, reply) => {
    const parsed = ListenerSessionRequest.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const result = await listenerService.createSession(request.user!.id, parsed.data.source);
    return reply.status(200).send(result);
  });

  app.post('/listener/session/answer', async (request, reply) => {
    const body =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as {
            sessionId?: unknown;
            conversationId?: unknown;
            sdp?: unknown;
          })
        : null;
    if (
      !body ||
      typeof body.sessionId !== 'string' ||
      typeof body.conversationId !== 'string' ||
      typeof body.sdp !== 'string' ||
      body.sdp.trim().length === 0
    ) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'sessionId, conversationId, and sdp are required',
        },
      });
    }
    const answer = await listenerService.answerSession(
      request.user!.id,
      body.sessionId,
      body.conversationId,
      body.sdp,
    );
    return reply.status(200).type('application/sdp').send(answer);
  });

  app.post('/listener/transcript', async (request, reply) => {
    const parsed = ListenerTranscriptRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const result = await listenerService.appendTranscript(request.user!.id, parsed.data);
    return reply.status(200).send(result);
  });

  app.post('/listener/explain', async (request, reply) => {
    const parsed = ListenerExplainRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const result = await listenerService.explain(request.user!.id, parsed.data);
    return reply.status(200).send(result);
  });
}
