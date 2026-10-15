import { conversationRepository, getPool, messageRepository } from '@aaa/db';
import { AppError } from '../../lib/errors.js';

export async function requireOwnedConversation(userId: string, conversationId: string) {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation || conversation.userId !== userId) {
    throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }
  return conversation;
}

export async function listConversations(userId: string) {
  getPool();
  return conversationRepository.listByUser(userId);
}

export async function updateConversationTitle(userId: string, conversationId: string, title: string) {
  getPool();

  await requireOwnedConversation(userId, conversationId);

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new AppError(400, 'Conversation title is required', 'VALIDATION_ERROR');
  }

  const updated = await conversationRepository.updateTitle(conversationId, normalizedTitle);
  if (!updated) {
    throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }

  return updated;
}

export async function deleteConversation(userId: string, conversationId: string) {
  getPool();

  await requireOwnedConversation(userId, conversationId);

  const deleted = await conversationRepository.delete(conversationId);
  if (!deleted) {
    throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }

  return { ok: true as const };
}

export async function getConversation(userId: string, conversationId: string) {
  getPool();

  const conversation = await requireOwnedConversation(userId, conversationId);
  const messages = await messageRepository.listByConversation(conversation.id);

  return {
    id: conversation.id,
    title: conversation.title,
    messages,
  };
}
