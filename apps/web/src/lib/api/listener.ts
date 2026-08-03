import { request, requestText } from './client';

export type ListenerAudioSource = 'microphone' | 'browser_tab';

export interface ListenerSession {
  sessionId: string;
  conversationId: string;
  transcriptMessageId: string;
  model: string;
}

export interface ListenerInsight {
  title: string;
  explanation: string;
}

export const listenerApi = {
  createSession(source: ListenerAudioSource) {
    return request<ListenerSession>('/api/listener/session', {
      method: 'POST',
      body: JSON.stringify({ source }),
    });
  },
  exchangeSdpAnswer(
    sessionId: string,
    conversationId: string,
    sdp: string,
  ) {
    return requestText('/api/listener/session/answer', {
      method: 'POST',
      body: JSON.stringify({ sessionId, conversationId, sdp }),
    });
  },
  appendTranscript(input: {
    sessionId: string;
    conversationId: string;
    transcriptMessageId: string;
    itemId: string;
    text: string;
    durationMs?: number;
  }) {
    return request<{
      conversationId: string;
      transcriptMessageId: string;
      rolledOver: boolean;
    }>('/api/listener/transcript', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  explain(input: {
    sessionId: string;
    conversationId: string;
    mode: 'selection' | 'auto';
    selectedText?: string;
    context: string;
    excludedInsights: string[];
  }) {
    return request<{
      conversationId: string;
      messageId?: string;
      insights: ListenerInsight[];
    }>('/api/listener/explain', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
