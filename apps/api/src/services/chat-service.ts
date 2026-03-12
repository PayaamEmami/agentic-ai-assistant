import { conversationRepository, getPool, messageRepository } from '@aaa/db';
import type { AssistantTextDoneEvent } from '@aaa/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { broadcast } from '../ws/connections.js';

export class ChatService {
  async sendMessage(
    userId: string,
    content: string,
    conversationId?: string,
    attachmentIds?: string[],
  ) {
    getPool();

    const conversation =
      conversationId === undefined
        ? await conversationRepository.create(userId)
        : await conversationRepository.findById(conversationId);

    if (!conversation) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    await messageRepository.create(conversation.id, 'user', [
      { type: 'text', text: content },
    ]);

    const recentMessages = await messageRepository.listByConversation(
      conversation.id,
      20,
    );

    // TODO: call retrieval bridge for additional context.
    // TODO: call agent orchestrator to generate assistant response.
    const placeholderResponse = 'Assistant response placeholder.';

    const assistantMessage = await messageRepository.create(
      conversation.id,
      'assistant',
      [{ type: 'text', text: placeholderResponse }],
    );

    const event: AssistantTextDoneEvent = {
      type: 'assistant.text.done',
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      fullText: placeholderResponse,
    };

    broadcast(conversation.id, event);

    logger.info({ userId, conversationId, content }, 'Processing chat message');
    logger.debug(
      {
        conversationId: conversation.id,
        historySize: recentMessages.length,
        attachmentCount: attachmentIds?.length ?? 0,
      },
      'Chat message processed',
    );

    return {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
    };
  }

  async listConversations(userId: string) {
    getPool();
    return conversationRepository.listByUser(userId);
  }

  async getConversation(conversationId: string) {
    getPool();

    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    const messages = await messageRepository.listByConversation(conversation.id);

    return {
      id: conversation.id,
      title: conversation.title,
      messages,
    };
  }
}
