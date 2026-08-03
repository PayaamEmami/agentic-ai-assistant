import { z } from 'zod';

export const ListenerAudioSourceDto = z.enum(['microphone', 'browser_tab']);
export type ListenerAudioSourceDto = z.infer<typeof ListenerAudioSourceDto>;

export const ListenerSessionRequest = z.object({
  source: ListenerAudioSourceDto.default('microphone'),
});
export type ListenerSessionRequest = z.infer<typeof ListenerSessionRequest>;

export const ListenerSessionResponse = z.object({
  sessionId: z.string().uuid(),
  conversationId: z.string().uuid(),
  transcriptMessageId: z.string().uuid(),
  model: z.string(),
});
export type ListenerSessionResponse = z.infer<typeof ListenerSessionResponse>;

export const ListenerTranscriptRequest = z.object({
  sessionId: z.string().uuid(),
  conversationId: z.string().uuid(),
  transcriptMessageId: z.string().uuid(),
  itemId: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(16000),
  durationMs: z.number().finite().nonnegative().optional(),
});
export type ListenerTranscriptRequest = z.infer<typeof ListenerTranscriptRequest>;

export const ListenerTranscriptResponse = z.object({
  conversationId: z.string().uuid(),
  transcriptMessageId: z.string().uuid(),
  rolledOver: z.boolean(),
});
export type ListenerTranscriptResponse = z.infer<typeof ListenerTranscriptResponse>;

export const ListenerConceptDto = z.object({
  title: z.string().trim().min(1).max(160),
  explanation: z.string().trim().min(1).max(8000),
});
export type ListenerConceptDto = z.infer<typeof ListenerConceptDto>;

export const ListenerExplainRequest = z
  .object({
    sessionId: z.string().uuid(),
    conversationId: z.string().uuid(),
    mode: z.enum(['selection', 'auto']),
    selectedText: z.string().trim().min(1).max(4000).optional(),
    context: z.string().trim().min(1).max(16000),
    excludedConcepts: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  })
  .superRefine((value, context) => {
    if (value.mode === 'selection' && !value.selectedText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedText'],
        message: 'selectedText is required for selection explanations',
      });
    }
  });
export type ListenerExplainRequest = z.infer<typeof ListenerExplainRequest>;

export const ListenerExplainResponse = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
  concepts: z.array(ListenerConceptDto).max(3),
});
export type ListenerExplainResponse = z.infer<typeof ListenerExplainResponse>;
