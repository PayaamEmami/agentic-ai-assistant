export const MessageRole = {
  User: 'user',
  Assistant: 'assistant',
  System: 'system',
  Tool: 'tool',
} as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

export const AttachmentKind = {
  Image: 'image',
  Document: 'document',
  Audio: 'audio',
  File: 'file',
} as const;
export type AttachmentKind = (typeof AttachmentKind)[keyof typeof AttachmentKind];

export const ApprovalStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Expired: 'expired',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ToolExecutionStatus = {
  Pending: 'pending',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  RequiresApproval: 'requires_approval',
} as const;
export type ToolExecutionStatus = (typeof ToolExecutionStatus)[keyof typeof ToolExecutionStatus];

export const SourceKind = {
  Document: 'document',
  WebPage: 'web_page',
  Email: 'email',
  CodeRepository: 'code_repository',
} as const;
export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

export const ConnectorKind = {
  GitHub: 'github',
  GoogleDocs: 'google_docs',
  GitHubTools: 'github_tools',
  GoogleDriveTools: 'google_drive_tools',
} as const;
export type ConnectorKind = (typeof ConnectorKind)[keyof typeof ConnectorKind];

export const MemoryKind = {
  Fact: 'fact',
  Preference: 'preference',
  Relationship: 'relationship',
  Project: 'project',
  Person: 'person',
  Instruction: 'instruction',
} as const;
export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export const AgentRole = {
  Orchestrator: 'orchestrator',
  Research: 'research',
  Tool: 'tool',
  Coding: 'coding',
  Verifier: 'verifier',
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];
