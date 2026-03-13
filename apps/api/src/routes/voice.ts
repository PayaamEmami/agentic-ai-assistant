import type { FastifyInstance } from 'fastify';
import {
  VoiceSessionRequest,
  VoiceMessageRequest,
  VoiceSpeechRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { ChatService } from '../services/chat-service.js';
import { VoiceService } from '../services/voice-service.js';

export async function voiceRoutes(app: FastifyInstance) {
  const voiceService = new VoiceService();
  const chatService = new ChatService();

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

  app.post('/voice/transcribe', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply
        .status(400)
        .send({ error: { code: 'NO_FILE', message: 'No audio file provided' } });
    }

    const transcript = await voiceService.transcribeAudio(request.user!.id, file);
    return reply.status(200).send({ transcript });
  });

  app.post('/voice/message', async (request, reply) => {
    const parsed = VoiceMessageRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const result = await chatService.sendVoiceMessage(
      request.user!.id,
      parsed.data.transcript,
      parsed.data.conversationId,
    );

    return reply.status(200).send({
      conversationId: result.conversationId,
      messageId: result.messageId,
      assistantText: result.assistantText,
      transcript: parsed.data.transcript,
    });
  });

  app.post('/voice/speech', async (request, reply) => {
    const parsed = VoiceSpeechRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const response = await voiceService.synthesizeSpeech(parsed.data.text);
    return reply
      .status(200)
      .header('Content-Type', response.contentType)
      .header('Cache-Control', 'no-store')
      .send(response.audio);
  });
}
