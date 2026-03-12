import type { FastifyInstance } from 'fastify';
import { VoiceSessionRequest } from '@aaa/shared';
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
}
