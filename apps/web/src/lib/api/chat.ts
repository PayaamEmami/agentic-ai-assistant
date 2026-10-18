import type { ChatModelId, ConversationListItem } from '@aaa/shared';
import { request } from './client';

export type ConversationSummaryResponse = ConversationListItem;

export const chatApi = {
  send(
    content: string,
    conversationId?: string,
    attachmentIds?: string[],
    clientRunId?: string,
    chatModel?: ChatModelId,
  ) {
    return request<{ conversationId: string; messageId: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ content, conversationId, attachmentIds, clientRunId, chatModel }),
    });
  },
  interruptRun(runId: string) {
    return request<{
      ok: boolean;
      status: 'interrupting' | 'not_found';
      conversationId?: string;
    }>(`/api/chat/runs/${runId}/interrupt`, {
      method: 'POST',
    });
  },
  listConversations() {
    return request<{ conversations: ConversationSummaryResponse[] }>('/api/conversations');
  },
  getConversation(id: string) {
    return request<{
      id: string;
      title: string | null;
      chatModel: ChatModelId;
      messages: Array<{ id: string; role: string; content: unknown[]; createdAt: string }>;
    }>(`/api/conversations/${id}`);
  },
  updateConversation(
    id: string,
    patch: { title?: string; chatModel?: ChatModelId },
    signal?: AbortSignal,
  ) {
    return request<{ conversation: ConversationSummaryResponse }>(`/api/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      signal,
    });
  },
  deleteConversation(id: string) {
    return request<{ ok: boolean }>(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
  },
};
