import type { FastifyInstance } from 'fastify';
import {
  ResendMessageParams,
  ResendMessageRequest,
  SendMessageRequest,
  UpdateConversationRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { ChatService } from '../services/chat/index.js';

interface ChatRouteOptions {
  chatService?: ChatService;
}

export async function chatRoutes(app: FastifyInstance, options: ChatRouteOptions = {}) {
  const chatService = options.chatService ?? new ChatService({ config: app.config });

  // User-authenticated routes. All routes registered in this scope require a
  // valid user bearer token via the addHook below.
  await app.register(async (userApp) => {
    userApp.addHook('preHandler', authenticate);

    userApp.post('/chat', async (request, reply) => {
      const parsed = SendMessageRequest.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const { conversationId, content, attachmentIds, clientRunId, chatModel } = parsed.data;
      const userId = request.user!.id;
      const result = await chatService.sendMessage(
        userId,
        content,
        conversationId,
        attachmentIds,
        clientRunId,
        chatModel,
      );
      return reply.status(200).send(result);
    });

    userApp.post<{ Params: { conversationId: string; messageId: string } }>(
      '/conversations/:conversationId/messages/:messageId/resend',
      async (request, reply) => {
        const params = ResendMessageParams.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: params.error.message },
          });
        }

        const parsed = ResendMessageRequest.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
          });
        }

        const { content, clientRunId, chatModel } = parsed.data;
        const result = await chatService.resendFromMessage(
          request.user!.id,
          params.data.conversationId,
          params.data.messageId,
          content,
          clientRunId,
          chatModel,
        );
        return reply.status(200).send(result);
      },
    );

    userApp.post<{ Params: { runId: string } }>(
      '/chat/runs/:runId/interrupt',
      async (request, reply) => {
        const result = await chatService.interruptRun(request.user!.id, request.params.runId);
        return reply.status(result.status === 'not_found' ? 404 : 200).send(result);
      },
    );

    userApp.get('/conversations', async (request, reply) => {
      const userId = request.user!.id;
      const conversations = await chatService.listConversations(userId);
      return reply.status(200).send({ conversations });
    });

    userApp.get<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
      const conversation = await chatService.getConversation(request.user!.id, request.params.id);
      return reply.status(200).send(conversation);
    });

    userApp.patch<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
      const parsed = UpdateConversationRequest.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const conversation = await chatService.updateConversation(
        request.user!.id,
        request.params.id,
        parsed.data,
      );
      return reply.status(200).send({ conversation });
    });

    userApp.delete<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
      const result = await chatService.deleteConversation(request.user!.id, request.params.id);
      return reply.status(200).send(result);
    });
  });
}
