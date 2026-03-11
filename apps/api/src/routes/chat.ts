import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { ChatService } from '../services/chat-service.js';

export async function chatRoutes(app: FastifyInstance) {
  const chatService = new ChatService();

  app.addHook('preHandler', authenticate);

  app.post<{
    Body: { conversationId?: string; content: string; attachmentIds?: string[] };
  }>('/chat', async (request, reply) => {
    const { conversationId, content, attachmentIds } = request.body;
    const userId = request.user!.id;
    const result = await chatService.sendMessage(
      userId,
      content,
      conversationId,
      attachmentIds,
    );
    return reply.status(200).send(result);
  });

  app.get('/conversations', async (request, reply) => {
    const userId = request.user!.id;
    const conversations = await chatService.listConversations(userId);
    return reply.status(200).send({ conversations });
  });

  app.get<{ Params: { id: string } }>(
    '/conversations/:id',
    async (request, reply) => {
      const conversation = await chatService.getConversation(
        request.params.id,
      );
      return reply.status(200).send(conversation);
    },
  );
}
