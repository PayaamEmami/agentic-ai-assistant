import type { FastifyInstance } from 'fastify';
import { SendMessageRequest, UpdateConversationRequest } from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { assertInternalServiceSecret } from '../lib/internal-service.js';
import { ChatService } from '../services/chat-service.js';

async function authenticateInternal(request: { headers: Record<string, unknown> }): Promise<void> {
  const header = request.headers['x-internal-service-secret'];
  const provided =
    typeof header === 'string' ? header : Array.isArray(header) ? (header[0] ?? null) : null;
  assertInternalServiceSecret(provided);
}

interface ChatRouteOptions {
  chatService?: ChatService;
}

export async function chatRoutes(app: FastifyInstance, options: ChatRouteOptions = {}) {
  const chatService = options.chatService ?? new ChatService();

  app.post<{ Params: { toolExecutionId: string } }>(
    '/chat/internal/tool-executions/:toolExecutionId/continue',
    async (request, reply) => {
      await authenticateInternal(request);
      const result = await chatService.continueAfterToolExecution(request.params.toolExecutionId);
      return reply.status(200).send(result);
    },
  );

  app.post('/chat', { preHandler: authenticate }, async (request, reply) => {
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

  app.post<{ Params: { runId: string } }>(
    '/chat/runs/:runId/interrupt',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = await chatService.interruptRun(request.user!.id, request.params.runId);
      return reply.status(result.status === 'not_found' ? 404 : 200).send(result);
    },
  );

  app.get('/conversations', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const conversations = await chatService.listConversations(userId);
    return reply.status(200).send({ conversations });
  });

  app.get<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const conversation = await chatService.getConversation(request.user!.id, request.params.id);
      return reply.status(200).send(conversation);
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: authenticate },
    async (request, reply) => {
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
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = await chatService.deleteConversation(request.user!.id, request.params.id);
      return reply.status(200).send(result);
    },
  );
}
