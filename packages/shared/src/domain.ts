import type {
  MessageRole,
  AttachmentKind,
  ApprovalStatus,
  ToolExecutionStatus,
  SourceKind,
  ConnectorKind,
  AgentRole,
} from './enums.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageRefContent {
  type: 'image_ref';
  attachmentId: string;
  mimeType: string;
}

export interface TranscriptContent {
  type: 'transcript';
  text: string;
  durationMs: number;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolExecutionId: string;
  output: unknown;
}

export interface CitationContent {
  type: 'citation';
  sourceId: string;
  excerpt: string;
}

export type MessageContent =
  | TextContent
  | ImageRefContent
  | TranscriptContent
  | ToolResultContent
  | CitationContent;

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: MessageContent[];
  createdAt: Date;
}

export interface Attachment {
  id: string;
  messageId: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
}

export interface Source {
  id: string;
  userId: string | null;
  kind: SourceKind;
  connectorKind: ConnectorKind | null;
  externalId: string | null;
  title: string;
  uri: string | null;
  createdAt: Date;
}

export interface Citation {
  sourceId: string;
  chunkId: string;
  excerpt: string;
  score: number;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  origin: 'native' | 'mcp';
  mcpServerId?: string;
  requiresApproval: boolean;
}

export interface ToolExecution {
  id: string;
  conversationId: string;
  messageId: string | null;
  toolName: string;
  input: unknown;
  output: unknown | null;
  status: ToolExecutionStatus;
  origin: 'native' | 'mcp';
  approvalId: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface Approval {
  id: string;
  userId: string;
  conversationId: string;
  toolExecutionId: string;
  description: string;
  status: ApprovalStatus;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface Document {
  id: string;
  userId: string | null;
  sourceId: string | null;
  title: string;
  content: string | null;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface Embedding {
  id: string;
  chunkId: string;
  vector: number[];
  model: string;
  createdAt: Date;
}

export interface Memory {
  id: string;
  userId: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Preference {
  id: string;
  userId: string;
  key: string;
  value: string;
  updatedAt: Date;
}

export interface ConnectorConfig {
  id: string;
  userId: string;
  kind: ConnectorKind;
  credentials: Record<string, unknown>;
  settings: Record<string, unknown>;
  lastSyncAt: Date | null;
  createdAt: Date;
}

export interface AgentTask {
  id: string;
  conversationId: string;
  agentRole: AgentRole;
  input: unknown;
  output: unknown | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  parentTaskId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
