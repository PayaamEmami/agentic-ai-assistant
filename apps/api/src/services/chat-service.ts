import { logger } from '../lib/logger.js';

export class ChatService {
  async sendMessage(
    userId: string,
    content: string,
    conversationId?: string,
    _attachmentIds?: string[],
  ) {
    // TODO: implement full chat flow:
    // 1. Create or get conversation
    // 2. Store user message
    // 3. Retrieve context (RAG)
    // 4. Run agent orchestrator
    // 5. Execute tool calls if needed
    // 6. Store assistant response
    // 7. Return response

    logger.info({ userId, conversationId, content }, 'Processing chat message');

    const msgId = crypto.randomUUID();
    const convId = conversationId ?? crypto.randomUUID();

    return {
      conversationId: convId,
      messageId: msgId,
    };
  }

  async listConversations(_userId: string) {
    // TODO: query database for user conversations
    return [];
  }

  async getConversation(conversationId: string) {
    // TODO: fetch conversation with messages
    return { id: conversationId, title: null, messages: [] };
  }
}
