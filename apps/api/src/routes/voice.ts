import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { VoiceService } from '../services/voice-service.js';

export async function voiceRoutes(app: FastifyInstance) {
  const voiceService = new VoiceService();

  app.addHook('preHandler', authenticate);

  app.post<{ Body: { conversationId?: string } }>(
    '/voice/session',
    async (request, reply) => {
      const userId = request.user!.id;
      const session = await voiceService.createSession(
        userId,
        request.body.conversationId,
      );
      return reply.status(200).send(session);
    },
  );
}
