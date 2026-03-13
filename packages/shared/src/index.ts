export {
  MessageRole,
  AttachmentKind,
  ApprovalStatus,
  ToolExecutionStatus,
  SourceKind,
  ConnectorKind,
  AgentRole,
} from './enums.js';
export type {
  MessageRole as MessageRoleType,
  AttachmentKind as AttachmentKindType,
  ApprovalStatus as ApprovalStatusType,
  ToolExecutionStatus as ToolExecutionStatusType,
  SourceKind as SourceKindType,
  ConnectorKind as ConnectorKindType,
  AgentRole as AgentRoleType,
} from './enums.js';

export type {
  User,
  Conversation,
  Message,
  MessageContent,
  TextContent,
  ImageRefContent,
  TranscriptContent,
  ToolResultContent,
  CitationContent,
  Attachment,
  Source,
  Citation,
  ToolDescriptor,
  ToolExecution,
  Approval,
  Document,
  Chunk,
  Embedding,
  Memory,
  Preference,
  ConnectorConfig,
  AgentTask,
} from './domain.js';

export {
  AuthCredentialsRequest,
  RegisterRequest,
  AuthUserDto,
  AuthResponse,
  SendMessageRequest,
  SendMessageResponse,
  UploadAttachmentResponse,
  ConversationListItem,
  ConversationListResponse,
  MessageDto,
  ConversationDetailResponse,
  ApprovalDecisionRequest,
  ApprovalDto,
  PendingApprovalsResponse,
  VoiceSessionRequest,
  VoiceSessionResponse,
  HealthResponse,
} from './dto.js';

export type { RealtimeEvent } from './events.js';
export type {
  AssistantTextEvent,
  AssistantTextDoneEvent,
  ToolStartEvent,
  ToolDoneEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  CitationEvent,
  VoiceTranscriptEvent,
  VoiceSessionEndedEvent,
  ErrorEvent,
} from './events.js';

export type { NativeToolDefinition } from './tools.js';
export { NATIVE_TOOL_DEFINITIONS } from './tools.js';
