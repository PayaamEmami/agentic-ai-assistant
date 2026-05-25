export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface SessionInit {
  sessionId: string;
  clientSecret: string;
  expiresAt: string;
  conversationId: string;
  model: string;
  voice: string;
}

export interface VoicePendingToolCall {
  callId: string;
  toolExecutionId: string;
  toolName: string;
  status: 'running' | 'requires_approval';
}

export interface BrowserVoiceSupport {
  supported: boolean;
  reason?: string;
}
