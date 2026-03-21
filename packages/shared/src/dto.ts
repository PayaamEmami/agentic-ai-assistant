import { z } from 'zod';

export const AuthCredentialsRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});
export type AuthCredentialsRequest = z.infer<typeof AuthCredentialsRequest>;

export const RegisterRequest = AuthCredentialsRequest.extend({
  displayName: z.string().min(1).max(120),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const AuthUserDto = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
});
export type AuthUserDto = z.infer<typeof AuthUserDto>;

export const AuthResponse = z.object({
  token: z.string(),
  user: AuthUserDto,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

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

export const VoiceTranscriptionResponse = z.object({
  transcript: z.string(),
});
export type VoiceTranscriptionResponse = z.infer<typeof VoiceTranscriptionResponse>;

export const VoiceMessageRequest = z.object({
  conversationId: z.string().uuid().optional(),
  transcript: z.string().min(1).max(32000),
});
export type VoiceMessageRequest = z.infer<typeof VoiceMessageRequest>;

export const VoiceMessageResponse = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  assistantText: z.string(),
  transcript: z.string(),
});
export type VoiceMessageResponse = z.infer<typeof VoiceMessageResponse>;

export const VoiceSpeechRequest = z.object({
  text: z.string().min(1).max(4000),
});
export type VoiceSpeechRequest = z.infer<typeof VoiceSpeechRequest>;

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ConnectorKindDto = z.enum(['github', 'google_docs']);
export type ConnectorKindDto = z.infer<typeof ConnectorKindDto>;

export const ConnectorStatusDto = z.enum(['pending', 'connected', 'failed']);
export type ConnectorStatusDto = z.infer<typeof ConnectorStatusDto>;

export const ConnectorSyncStatusDto = z.enum(['pending', 'running', 'completed', 'failed']);
export type ConnectorSyncStatusDto = z.infer<typeof ConnectorSyncStatusDto>;

export const ConnectorSyncRunDto = z.object({
  id: z.string().uuid(),
  trigger: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  itemsDiscovered: z.number().int().nonnegative(),
  itemsQueued: z.number().int().nonnegative(),
  itemsDeleted: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errorSummary: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type ConnectorSyncRunDto = z.infer<typeof ConnectorSyncRunDto>;

export const ConnectorSourceDto = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  uri: z.string().nullable(),
  mimeType: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type ConnectorSourceDto = z.infer<typeof ConnectorSourceDto>;

export const ConnectorSummaryDto = z.object({
  id: z.string().uuid(),
  kind: ConnectorKindDto,
  status: ConnectorStatusDto,
  lastSyncAt: z.string().datetime().nullable(),
  lastSyncStatus: ConnectorSyncStatusDto.nullable(),
  lastError: z.string().nullable(),
  hasCredentials: z.boolean(),
  selectedRepoCount: z.number().int().nonnegative().optional(),
  recentSyncRuns: z.array(ConnectorSyncRunDto).default([]),
  recentSources: z.array(ConnectorSourceDto).default([]),
});
export type ConnectorSummaryDto = z.infer<typeof ConnectorSummaryDto>;

export const ConnectorListResponse = z.object({
  connectors: z.array(ConnectorSummaryDto),
});
export type ConnectorListResponse = z.infer<typeof ConnectorListResponse>;

export const ConnectorConnectStartResponse = z.object({
  authorizationUrl: z.string().url(),
});
export type ConnectorConnectStartResponse = z.infer<typeof ConnectorConnectStartResponse>;

export const ConnectorSyncResponse = z.object({
  queued: z.boolean(),
});
export type ConnectorSyncResponse = z.infer<typeof ConnectorSyncResponse>;

export const ConnectorDisconnectResponse = z.object({
  ok: z.literal(true),
});
export type ConnectorDisconnectResponse = z.infer<typeof ConnectorDisconnectResponse>;

export const GitHubRepositoryDto = z.object({
  id: z.number().int(),
  name: z.string(),
  fullName: z.string(),
  owner: z.string(),
  defaultBranch: z.string(),
  private: z.boolean(),
  selected: z.boolean(),
});
export type GitHubRepositoryDto = z.infer<typeof GitHubRepositoryDto>;

export const GitHubRepositoriesResponse = z.object({
  repositories: z.array(GitHubRepositoryDto),
});
export type GitHubRepositoriesResponse = z.infer<typeof GitHubRepositoriesResponse>;

export const GitHubRepoSelectionRequest = z.object({
  repositoryIds: z.array(z.number().int()).max(100),
});
export type GitHubRepoSelectionRequest = z.infer<typeof GitHubRepoSelectionRequest>;
