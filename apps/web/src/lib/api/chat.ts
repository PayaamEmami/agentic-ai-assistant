import type { ConversationListItem } from '@aaa/shared';
import { request } from './client';

export type ConversationSummaryResponse = ConversationListItem;

export const chatApi = {
  send(content: string, conversationId?: string, attachmentIds?: string[], clientRunId?: string) {
    return request<{ conversationId: string; messageId: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ content, conversationId, attachmentIds, clientRunId }),
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
      messages: Array<{ id: string; role: string; content: unknown[]; createdAt: string }>;
    }>(`/api/conversations/${id}`);
  },
  updateConversation(id: string, title: string) {
    return request<{ conversation: ConversationSummaryResponse }>(`/api/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },
  deleteConversation(id: string) {
    return request<{ ok: boolean }>(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
  },
};
