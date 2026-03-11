import { z } from 'zod';

export const SendMessageRequest = z.object({
  conversationId: z.string().uuid().optional(),
  content: z.string().min(1).max(32000),
  attachmentIds: z.array(z.string().uuid()).optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const SendMessageResponse = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

export const UploadAttachmentResponse = z.object({
  attachmentId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
});
export type UploadAttachmentResponse = z.infer<typeof UploadAttachmentResponse>;

export const ConversationListItem = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationListItem = z.infer<typeof ConversationListItem>;

export const ConversationListResponse = z.object({
  conversations: z.array(ConversationListItem),
});
export type ConversationListResponse = z.infer<typeof ConversationListResponse>;

export const MessageDto = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.array(z.record(z.unknown())),
  createdAt: z.string().datetime(),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const ConversationDetailResponse = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  messages: z.array(MessageDto),
});
export type ConversationDetailResponse = z.infer<typeof ConversationDetailResponse>;

export const ApprovalDecisionRequest = z.object({
  status: z.enum(['approved', 'rejected']),
});
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequest>;

export const ApprovalDto = z.object({
  id: z.string().uuid(),
  toolExecutionId: z.string().uuid(),
  description: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
});
export type ApprovalDto = z.infer<typeof ApprovalDto>;

export const PendingApprovalsResponse = z.object({
  approvals: z.array(ApprovalDto),
});
export type PendingApprovalsResponse = z.infer<typeof PendingApprovalsResponse>;

export const VoiceSessionRequest = z.object({
  conversationId: z.string().uuid().optional(),
});
export type VoiceSessionRequest = z.infer<typeof VoiceSessionRequest>;

export const VoiceSessionResponse = z.object({
  sessionId: z.string(),
  ephemeralToken: z.string(),
  expiresAt: z.string().datetime(),
  conversationId: z.string().uuid(),
});
export type VoiceSessionResponse = z.infer<typeof VoiceSessionResponse>;

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
