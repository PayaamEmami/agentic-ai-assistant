import { z } from 'zod';

export const VoiceSessionRequest = z.object({
  conversationId: z.string().uuid().optional(),
});
export type VoiceSessionRequest = z.infer<typeof VoiceSessionRequest>;

export const VoiceSessionResponse = z.object({
  sessionId: z.string(),
  clientSecret: z.string(),
  expiresAt: z.string().datetime(),
  conversationId: z.string().uuid(),
  model: z.string(),
  voice: z.string(),
});
export type VoiceSessionResponse = z.infer<typeof VoiceSessionResponse>;

export const VoiceTurnStartRequest = z.object({
  conversationId: z.string().uuid().optional(),
  userTranscript: z.string().trim().min(1).max(32000),
});
export type VoiceTurnStartRequest = z.infer<typeof VoiceTurnStartRequest>;

export const VoiceTurnStartResponse = z.object({
  conversationId: z.string().uuid(),
  voiceTurnId: z.string().uuid(),
  userMessageId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
});
export type VoiceTurnStartResponse = z.infer<typeof VoiceTurnStartResponse>;

export const VoiceTurnAssistantTextRequest = z.object({
  text: z.string().min(0).max(32000),
});
export type VoiceTurnAssistantTextRequest = z.infer<typeof VoiceTurnAssistantTextRequest>;

export const VoiceTurnAssistantTextResponse = z.object({
  voiceTurnId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
});
export type VoiceTurnAssistantTextResponse = z.infer<typeof VoiceTurnAssistantTextResponse>;

export const VoiceTurnCompleteRequest = z.object({
  text: z.string().min(0).max(32000).optional(),
});
export type VoiceTurnCompleteRequest = z.infer<typeof VoiceTurnCompleteRequest>;

export const VoiceTurnCompleteResponse = z.object({
  conversationId: z.string().uuid(),
  voiceTurnId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
});
export type VoiceTurnCompleteResponse = z.infer<typeof VoiceTurnCompleteResponse>;

export const VoiceTurnPrepareRequest = z.object({
  userTranscript: z.string().trim().min(1).max(32000).optional(),
});
export type VoiceTurnPrepareRequest = z.infer<typeof VoiceTurnPrepareRequest>;

export const VoiceTurnPrepareResponse = z.object({
  voiceTurnId: z.string().uuid(),
  instructions: z.string(),
  retrievedContext: z.string().optional(),
  hasRetrieval: z.boolean(),
});
export type VoiceTurnPrepareResponse = z.infer<typeof VoiceTurnPrepareResponse>;

export const VoiceToolCallRequest = z.object({
  conversationId: z.string().uuid(),
  voiceTurnId: z.string().uuid(),
  callId: z.string().trim().min(1).max(200),
  toolName: z.string().trim().min(1).max(200),
  argumentsJson: z.string().max(32000),
});
export type VoiceToolCallRequest = z.infer<typeof VoiceToolCallRequest>;

export const VoiceToolCallResponse = z.object({
  toolExecutionId: z.string().uuid(),
  status: z.enum(['requires_approval', 'enqueued']),
});
export type VoiceToolCallResponse = z.infer<typeof VoiceToolCallResponse>;

export const VoiceSessionInterruptRequest = z.object({
  conversationId: z.string().uuid(),
  voiceTurnId: z.string().uuid().optional(),
});
export type VoiceSessionInterruptRequest = z.infer<typeof VoiceSessionInterruptRequest>;

export const VoiceSessionInterruptResponse = z.object({
  ok: z.literal(true),
  conversationId: z.string().uuid(),
});
export type VoiceSessionInterruptResponse = z.infer<typeof VoiceSessionInterruptResponse>;
