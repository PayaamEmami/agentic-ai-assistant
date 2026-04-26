import type { FastifyInstance } from 'fastify';
import {
  VoiceSessionInterruptRequest,
  VoiceSessionRequest,
  VoiceToolCallRequest,
  VoiceTurnAssistantTextRequest,
  VoiceTurnCompleteRequest,
  VoiceTurnPrepareRequest,
  VoiceTurnRequest,
  VoiceTurnStartRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { VoiceService } from '../services/voice-service.js';

interface VoiceRouteOptions {
  voiceService?: VoiceService;
}

export async function voiceRoutes(app: FastifyInstance, options: VoiceRouteOptions = {}) {
  const voiceService = options.voiceService ?? new VoiceService();

  app.addHook('preHandler', authenticate);

  app.post('/voice/session', async (request, reply) => {
    const parsed = VoiceSessionRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const userId = request.user!.id;
    const session = await voiceService.createSession(userId, parsed.data.conversationId);
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

  app.post('/voice/turns/start', async (request, reply) => {
    const parsed = VoiceTurnStartRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const result = await voiceService.startTurn(
      request.user!.id,
      parsed.data.userTranscript,
      parsed.data.conversationId,
    );
    return reply.status(200).send(result);
  });

  app.post<{ Params: { id: string } }>(
    '/voice/turns/:id/assistant-text',
    async (request, reply) => {
      const parsed = VoiceTurnAssistantTextRequest.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const result = await voiceService.updateAssistantText(
        request.user!.id,
        request.params.id,
        parsed.data.text,
      );
      return reply.status(200).send(result);
    },
  );

  app.post<{ Params: { id: string } }>('/voice/turns/:id/prepare', async (request, reply) => {
    const parsed = VoiceTurnPrepareRequest.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const result = await voiceService.prepareTurn(
      request.user!.id,
      request.params.id,
      parsed.data.userTranscript,
    );
    return reply.status(200).send(result);
  });

  app.post<{ Params: { id: string } }>('/voice/turns/:id/complete', async (request, reply) => {
    const parsed = VoiceTurnCompleteRequest.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const result = await voiceService.completeTurn(
      request.user!.id,
      request.params.id,
      parsed.data.text,
    );
    return reply.status(200).send(result);
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

  app.post<{ Params: { id: string } }>('/voice/sessions/:id/interrupt', async (request, reply) => {
    const parsed = VoiceSessionInterruptRequest.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const result = await voiceService.interruptSession(
      request.user!.id,
      request.params.id,
      parsed.data.conversationId,
      parsed.data.voiceTurnId,
    );

    return reply.status(200).send({
      ok: true as const,
      conversationId: result.conversationId,
    });
  });

  app.post('/voice/tool-calls', async (request, reply) => {
    const parsed = VoiceToolCallRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const result = await voiceService.submitToolCall(request.user!.id, {
      conversationId: parsed.data.conversationId,
      voiceTurnId: parsed.data.voiceTurnId,
      callId: parsed.data.callId,
      toolName: parsed.data.toolName,
      argumentsJson: parsed.data.argumentsJson,
    });

    return reply.status(200).send(result);
  });
}
