import type { FastifyInstance } from 'fastify';
import {
  VoiceSessionRequest,
  VoiceTurnRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { VoiceService } from '../services/voice-service.js';

export async function voiceRoutes(app: FastifyInstance) {
  const voiceService = new VoiceService();

  app.addHook('preHandler', authenticate);

  app.post('/voice/session', async (request, reply) => {
    const parsed = VoiceSessionRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const userId = request.user!.id;
    const session = await voiceService.createSession(
      userId,
      parsed.data.conversationId,
    );
    return reply.status(200).send(session);
  });

  app.post('/voice/session/answer', async (request, reply) => {
    const body =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as { conversationId?: unknown; sdp?: unknown; sessionId?: unknown })
        : null;
    if (
      !body ||
      typeof body.conversationId !== 'string' ||
      body.conversationId.trim().length === 0 ||
      typeof body.sdp !== 'string' ||
      body.sdp.trim().length === 0
    ) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'conversationId and sdp are required' },
      });
    }

    const answer = await voiceService.answerSession(
      request.user!.id,
      body.conversationId,
      body.sdp,
      typeof body.sessionId === 'string' && body.sessionId.trim().length > 0
        ? body.sessionId
        : undefined,
    );

    return reply.status(200).type('application/sdp').send(answer);
  });

  app.post('/voice/turns', async (request, reply) => {
    const parsed = VoiceTurnRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const result = await voiceService.persistTurn(
      request.user!.id,
      parsed.data.userTranscript,
      parsed.data.assistantTranscript,
      parsed.data.conversationId,
    );

    return reply.status(200).send(result);
  });
}
