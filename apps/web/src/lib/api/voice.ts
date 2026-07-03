import { request, requestText } from './client';

export const voiceApi = {
  createSession(conversationId?: string) {
    return request<{
      sessionId: string;
      clientSecret: string;
      expiresAt: string;
      conversationId: string;
      model: string;
      voice: string;
    }>('/api/voice/session', {
      method: 'POST',
      body: JSON.stringify({ conversationId }),
    });
  },
  exchangeSdpAnswer(sessionId: string, conversationId: string, sdp: string) {
    return requestText('/api/voice/session/answer', {
      method: 'POST',
      body: JSON.stringify({ conversationId, sdp, sessionId }),
    });
  },
  startTurn(conversationId: string | undefined, userTranscript: string) {
    return request<{
      conversationId: string;
      voiceTurnId: string;
      userMessageId: string;
      assistantMessageId: string;
    }>('/api/voice/turns/start', {
      method: 'POST',
      body: JSON.stringify({ conversationId, userTranscript }),
    });
  },
  updateAssistantText(voiceTurnId: string, text: string) {
    return request<{
      voiceTurnId: string;
      assistantMessageId: string;
    }>(`/api/voice/turns/${voiceTurnId}/assistant-text`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },
  completeTurn(voiceTurnId: string, text?: string) {
    return request<{
      conversationId: string;
      voiceTurnId: string;
      assistantMessageId: string;
    }>(`/api/voice/turns/${voiceTurnId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },
  prepareTurn(voiceTurnId: string, userTranscript?: string) {
    return request<{
      voiceTurnId: string;
      instructions: string;
      retrievedContext?: string;
      hasRetrieval: boolean;
    }>(`/api/voice/turns/${voiceTurnId}/prepare`, {
      method: 'POST',
      body: JSON.stringify(userTranscript ? { userTranscript } : {}),
    });
  },
  tools: {
    submitCall(input: {
      conversationId: string;
      voiceTurnId: string;
      callId: string;
      toolName: string;
      argumentsJson: string;
    }) {
      return request<{
        toolExecutionId: string;
        status: 'requires_approval' | 'enqueued';
      }>('/api/voice/tool-calls', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  },
  interrupt(sessionId: string, input: { conversationId: string; voiceTurnId?: string }) {
    return request<{ ok: true; conversationId: string }>(
      `/api/voice/sessions/${sessionId}/interrupt`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  },
};
