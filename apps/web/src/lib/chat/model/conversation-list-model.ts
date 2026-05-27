import type { ConversationListItem } from '@aaa/shared';
import type { ConversationSummary } from './message-types';

export function sortConversations(items: ConversationSummary[]): ConversationSummary[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

export function normalizeConversationSummary(
  conversation: ConversationListItem,
): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function buildConversationTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Untitled conversation';
  }

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77).trimEnd()}...`;
}

export function upsertConversation(
  conversations: ConversationSummary[],
  conversation: ConversationSummary,
): ConversationSummary[] {
  const next = conversations.filter((item) => item.id !== conversation.id);
  next.push(conversation);
  return sortConversations(next);
}

export function mergeConversations(
  local: ConversationSummary[],
  remote: ConversationSummary[],
): ConversationSummary[] {
  const map = new Map<string, ConversationSummary>();

  for (const item of remote) {
    map.set(item.id, item);
  }

  for (const item of local) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }

  return sortConversations(Array.from(map.values()));
}
