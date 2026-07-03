import { z } from 'zod';
import { MessageContentDto } from './content.js';
import { MessageRoleValues } from './enum-values.js';

export const SendMessageRequest = z.object({
  conversationId: z.string().uuid().optional(),
  content: z.string().min(1).max(32000),
  attachmentIds: z.array(z.string().uuid()).optional(),
  clientRunId: z.string().uuid().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const SendMessageResponse = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

export const InterruptChatRunResponse = z.object({
  ok: z.boolean(),
  status: z.enum(['interrupting', 'not_found']),
  conversationId: z.string().uuid().optional(),
});
export type InterruptChatRunResponse = z.infer<typeof InterruptChatRunResponse>;

export const UploadAttachmentResponse = z.object({
  attachmentId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  kind: z.enum(['image', 'document', 'audio', 'file']),
  indexedForRag: z.boolean(),
  documentId: z.string().uuid().nullable().optional(),
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
  role: z.enum(MessageRoleValues),
  content: z.array(MessageContentDto),
  createdAt: z.string().datetime(),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const ConversationDetailResponse = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  messages: z.array(MessageDto),
});
export type ConversationDetailResponse = z.infer<typeof ConversationDetailResponse>;

export const UpdateConversationRequest = z.object({
  title: z.string().trim().min(1).max(120),
});
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequest>;

export const UpdateConversationResponse = z.object({
  conversation: ConversationListItem,
});
export type UpdateConversationResponse = z.infer<typeof UpdateConversationResponse>;

export const DeleteConversationResponse = z.object({
  ok: z.literal(true),
});
export type DeleteConversationResponse = z.infer<typeof DeleteConversationResponse>;

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
