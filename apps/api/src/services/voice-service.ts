import { logger } from '../lib/logger.js';

export class VoiceService {
  async createSession(userId: string, conversationId?: string) {
    // TODO: implement voice session bootstrap:
    // 1. Create or get conversation
    // 2. Request ephemeral token from OpenAI Realtime API
    // 3. Return session details for client to connect

    logger.info({ userId, conversationId }, 'Creating voice session');

    const convId = conversationId ?? crypto.randomUUID();
    return {
      sessionId: crypto.randomUUID(),
      ephemeralToken: 'placeholder-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      conversationId: convId,
    };
  }
}
