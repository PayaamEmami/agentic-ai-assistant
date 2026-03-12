import crypto from 'node:crypto';
import { conversationRepository, getPool } from '@aaa/db';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export class VoiceService {
  async createSession(userId: string, conversationId?: string) {
    getPool();

    const conversation =
      conversationId === undefined
        ? await conversationRepository.create(userId)
        : await conversationRepository.findById(conversationId);

    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    logger.info({ userId, conversationId: conversation.id }, 'Creating voice session');

    return {
      sessionId: crypto.randomUUID(),
      ephemeralToken: `dev-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      conversationId: conversation.id,
    };
  }
}
