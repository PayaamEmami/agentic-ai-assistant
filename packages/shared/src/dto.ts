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
  clientSecret: z.string(),
  expiresAt: z.string().datetime(),
  conversationId: z.string().uuid(),
  model: z.string(),
  voice: z.string(),
});
export type VoiceSessionResponse = z.infer<typeof VoiceSessionResponse>;

export const VoiceTurnRequest = z.object({
  conversationId: z.string().uuid().optional(),
  userTranscript: z.string().trim().min(1).max(32000),
  assistantTranscript: z.string().trim().min(1).max(32000),
});
export type VoiceTurnRequest = z.infer<typeof VoiceTurnRequest>;

export const VoiceTurnResponse = z.object({
  conversationId: z.string().uuid(),
  userMessageId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
});
export type VoiceTurnResponse = z.infer<typeof VoiceTurnResponse>;

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const AppKindDto = z.enum(['github', 'google']);
export type AppKindDto = z.infer<typeof AppKindDto>;

export const AppCapabilityDto = z.enum(['knowledge', 'tools']);
export type AppCapabilityDto = z.infer<typeof AppCapabilityDto>;

export const McpIntegrationKindDto = z.enum(['playwright']);
export type McpIntegrationKindDto = z.infer<typeof McpIntegrationKindDto>;

export const MemoryKindDto = z.enum([
  'fact',
  'preference',
  'relationship',
  'project',
  'person',
  'instruction',
]);
export type MemoryKindDto = z.infer<typeof MemoryKindDto>;

export const AppStatusDto = z.enum(['pending', 'connected', 'failed']);
export type AppStatusDto = z.infer<typeof AppStatusDto>;

export const AppSyncStatusDto = z.enum(['pending', 'running', 'completed', 'failed']);
export type AppSyncStatusDto = z.infer<typeof AppSyncStatusDto>;

export const AppSyncRunDto = z.object({
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
export type AppSyncRunDto = z.infer<typeof AppSyncRunDto>;

export const AppSourceDto = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  uri: z.string().nullable(),
  mimeType: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type AppSourceDto = z.infer<typeof AppSourceDto>;

export const AppCapabilitySummaryDto = z.object({
  capability: AppCapabilityDto,
  status: AppStatusDto,
  lastSyncAt: z.string().datetime().nullable(),
  lastSyncStatus: AppSyncStatusDto.nullable(),
  lastError: z.string().nullable(),
  hasCredentials: z.boolean(),
  totalSourceCount: z.number().int().nonnegative().default(0),
  searchableSourceCount: z.number().int().nonnegative().default(0),
  recentSyncRuns: z.array(AppSyncRunDto).default([]),
  recentSources: z.array(AppSourceDto).default([]),
});
export type AppCapabilitySummaryDto = z.infer<typeof AppCapabilitySummaryDto>;

export const AppSummaryDto = z.object({
  kind: AppKindDto,
  displayName: z.string(),
  status: AppStatusDto,
  hasCredentials: z.boolean(),
  lastError: z.string().nullable(),
  selectedRepoCount: z.number().int().nonnegative().optional(),
  knowledge: AppCapabilitySummaryDto,
  tools: AppCapabilitySummaryDto,
});
export type AppSummaryDto = z.infer<typeof AppSummaryDto>;

export const AppListResponse = z.object({
  apps: z.array(AppSummaryDto),
});
export type AppListResponse = z.infer<typeof AppListResponse>;

export const AppConnectResponse = z.object({
  authorizationUrl: z.string().url(),
});
export type AppConnectResponse = z.infer<typeof AppConnectResponse>;

export const AppSyncResponse = z.object({
  queued: z.boolean(),
});
export type AppSyncResponse = z.infer<typeof AppSyncResponse>;

export const AppDisconnectResponse = z.object({
  ok: z.literal(true),
});
export type AppDisconnectResponse = z.infer<typeof AppDisconnectResponse>;

export const McpProfileStatusDto = z.enum(['pending', 'connected', 'failed']);
export type McpProfileStatusDto = z.infer<typeof McpProfileStatusDto>;

export const McpBrowserSessionPurposeDto = z.enum(['sign_in', 'manual', 'handoff']);
export type McpBrowserSessionPurposeDto = z.infer<typeof McpBrowserSessionPurposeDto>;

export const McpBrowserSessionStatusDto = z.enum([
  'pending',
  'active',
  'completed',
  'cancelled',
  'failed',
  'expired',
  'crashed',
]);
export type McpBrowserSessionStatusDto = z.infer<typeof McpBrowserSessionStatusDto>;

export const McpCatalogEntryDto = z.object({
  kind: McpIntegrationKindDto,
  displayName: z.string(),
  description: z.string(),
  supportsMultipleProfiles: z.boolean(),
  requiresDefaultProfile: z.boolean(),
  authModes: z.array(z.enum(['embedded_browser', 'stored_secret'])),
});
export type McpCatalogEntryDto = z.infer<typeof McpCatalogEntryDto>;

export const McpCatalogResponse = z.object({
  integrations: z.array(McpCatalogEntryDto),
});
export type McpCatalogResponse = z.infer<typeof McpCatalogResponse>;

export const McpProfileSummaryDto = z.object({
  id: z.string().uuid(),
  integrationKind: McpIntegrationKindDto,
  profileLabel: z.string(),
  status: McpProfileStatusDto,
  hasCredentials: z.boolean(),
  lastError: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type McpProfileSummaryDto = z.infer<typeof McpProfileSummaryDto>;

export const McpProfileListResponse = z.object({
  profiles: z.array(McpProfileSummaryDto),
});
export type McpProfileListResponse = z.infer<typeof McpProfileListResponse>;

export const McpProfileCreateRequest = z.object({
  integrationKind: McpIntegrationKindDto,
  profileLabel: z.string().trim().min(1).max(120),
  authMode: z.enum(['embedded_browser', 'stored_secret']).optional(),
  secretProfile: z.record(z.unknown()).optional(),
});
export type McpProfileCreateRequest = z.infer<typeof McpProfileCreateRequest>;

export const McpProfileCreateResponse = z.object({
  profile: McpProfileSummaryDto,
});
export type McpProfileCreateResponse = z.infer<typeof McpProfileCreateResponse>;

export const McpProfileDefaultResponse = z.object({
  ok: z.literal(true),
  profile: McpProfileSummaryDto,
});
export type McpProfileDefaultResponse = z.infer<typeof McpProfileDefaultResponse>;

export const BrowserPageDto = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  isSelected: z.boolean(),
});
export type BrowserPageDto = z.infer<typeof BrowserPageDto>;

export const McpBrowserSessionDto = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  mcpProfileId: z.string().uuid(),
  messageId: z.string().uuid().nullable(),
  purpose: McpBrowserSessionPurposeDto,
  status: McpBrowserSessionStatusDto,
  conversationId: z.string().uuid().nullable(),
  toolExecutionId: z.string().uuid().nullable(),
  selectedPageId: z.string().nullable(),
  metadata: z.record(z.unknown()),
  lastClientSeenAt: z.string().datetime().nullable(),
  lastFrameAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type McpBrowserSessionDto = z.infer<typeof McpBrowserSessionDto>;

export const McpBrowserSessionResponse = z.object({
  session: McpBrowserSessionDto,
  pages: z.array(BrowserPageDto),
});
export type McpBrowserSessionResponse = z.infer<typeof McpBrowserSessionResponse>;

export const McpBrowserSessionListResponse = z.object({
  sessions: z.array(McpBrowserSessionDto),
});
export type McpBrowserSessionListResponse = z.infer<typeof McpBrowserSessionListResponse>;

export const McpBrowserSessionCreateRequest = z.object({
  purpose: McpBrowserSessionPurposeDto.default('manual'),
  conversationId: z.string().uuid().optional(),
  toolExecutionId: z.string().uuid().optional(),
});
export type McpBrowserSessionCreateRequest = z.infer<typeof McpBrowserSessionCreateRequest>;

export const McpBrowserSessionPersistRequest = z.object({
  persistAsDefault: z.boolean().optional(),
});
export type McpBrowserSessionPersistRequest = z.infer<typeof McpBrowserSessionPersistRequest>;

export const InternalPlaywrightExecuteRequest = z.object({
  toolExecutionId: z.string().uuid().optional(),
  toolName: z.string().min(1),
  input: z.record(z.unknown()),
  conversationId: z.string().uuid().optional(),
  userId: z.string().uuid(),
  mcpProfileId: z.string().uuid(),
});
export type InternalPlaywrightExecuteRequest = z.infer<typeof InternalPlaywrightExecuteRequest>;

export const InternalPlaywrightExecuteResponse = z.object({
  success: z.boolean(),
  result: z.unknown().nullable(),
  error: z.string().optional(),
});
export type InternalPlaywrightExecuteResponse = z.infer<typeof InternalPlaywrightExecuteResponse>;

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

export const PersonalizationProfileDto = z.object({
  writingStyle: z.string().nullable(),
  tonePreference: z.string().nullable(),
});
export type PersonalizationProfileDto = z.infer<typeof PersonalizationProfileDto>;

export const MemoryItemDto = z.object({
  id: z.string().uuid(),
  kind: MemoryKindDto,
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MemoryItemDto = z.infer<typeof MemoryItemDto>;

export const PersonalizationResponse = z.object({
  profile: PersonalizationProfileDto,
  memories: z.array(MemoryItemDto),
});
export type PersonalizationResponse = z.infer<typeof PersonalizationResponse>;

export const UpdatePersonalizationProfileRequest = z.object({
  writingStyle: z.string().max(500).nullable().optional(),
  tonePreference: z.string().max(500).nullable().optional(),
});
export type UpdatePersonalizationProfileRequest = z.infer<
  typeof UpdatePersonalizationProfileRequest
>;

export const CreateMemoryRequest = z.object({
  kind: MemoryKindDto,
  content: z.string().trim().min(1).max(2000),
});
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequest>;

export const UpdateMemoryRequest = z.object({
  content: z.string().trim().min(1).max(2000),
});
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequest>;

export const MemoryMutationResponse = z.object({
  memory: MemoryItemDto,
});
export type MemoryMutationResponse = z.infer<typeof MemoryMutationResponse>;

export const DeleteMemoryResponse = z.object({
  ok: z.literal(true),
});
export type DeleteMemoryResponse = z.infer<typeof DeleteMemoryResponse>;

export const ClientLogLevelDto = z.enum(['warn', 'error']);
export type ClientLogLevelDto = z.infer<typeof ClientLogLevelDto>;

export const ClientLogPayload = z.object({
  level: ClientLogLevelDto,
  event: z.string().min(1).max(120),
  component: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  requestId: z.string().max(120).optional(),
  correlationId: z.string().max(120).optional(),
  clientSessionId: z.string().max(120).optional(),
  conversationId: z.string().uuid().optional(),
  voiceSessionId: z.string().max(120).optional(),
  context: z.record(z.unknown()).default({}),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(1000).optional(),
  timestamp: z.string().datetime(),
});
export type ClientLogPayload = z.infer<typeof ClientLogPayload>;

export const ClientLogRequest = z.object({
  logs: z.array(ClientLogPayload).min(1).max(20),
});
export type ClientLogRequest = z.infer<typeof ClientLogRequest>;

export const ClientLogResponse = z.object({
  accepted: z.boolean(),
});
export type ClientLogResponse = z.infer<typeof ClientLogResponse>;

export const ClientTelemetryMetricNameDto = z.enum(['CLS', 'INP', 'LCP', 'FCP', 'TTFB']);
export type ClientTelemetryMetricNameDto = z.infer<typeof ClientTelemetryMetricNameDto>;

export const ClientTelemetryMetricPayload = z.object({
  name: ClientTelemetryMetricNameDto,
  value: z.number().finite().nonnegative(),
  rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
  id: z.string().max(120).optional(),
  requestId: z.string().max(120).optional(),
  correlationId: z.string().max(120).optional(),
  clientSessionId: z.string().max(120).optional(),
  conversationId: z.string().uuid().optional(),
  voiceSessionId: z.string().max(120).optional(),
  route: z.string().max(500).optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(1000).optional(),
  timestamp: z.string().datetime(),
});
export type ClientTelemetryMetricPayload = z.infer<typeof ClientTelemetryMetricPayload>;

export const ClientTelemetryRequest = z.object({
  metrics: z.array(ClientTelemetryMetricPayload).min(1).max(20),
});
export type ClientTelemetryRequest = z.infer<typeof ClientTelemetryRequest>;

export const ClientTelemetryResponse = z.object({
  accepted: z.boolean(),
});
export type ClientTelemetryResponse = z.infer<typeof ClientTelemetryResponse>;
