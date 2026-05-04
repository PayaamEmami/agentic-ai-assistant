import type { FastifyInstance } from 'fastify';
import { SendMessageRequest, UpdateConversationRequest } from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { ChatService } from '../services/chat-service.js';

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

      const { conversationId, content, attachmentIds, clientRunId } = parsed.data;
      const userId = request.user!.id;
      const result = await chatService.sendMessage(
        userId,
        content,
        conversationId,
        attachmentIds,
        clientRunId,
      );
      return reply.status(200).send(result);
    });

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

      const conversation = await chatService.updateConversationTitle(
        request.user!.id,
        request.params.id,
        parsed.data.title,
      );
      return reply.status(200).send({ conversation });
    });

    userApp.delete<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
      const result = await chatService.deleteConversation(request.user!.id, request.params.id);
      return reply.status(200).send(result);
    });
  });
}
