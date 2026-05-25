import type {
  AttachmentRefContent,
  CitationContent,
  MessageContent,
  MessageRoleType,
  StatusContent,
  TextContent,
  ToolResultContent,
  TranscriptContent,
} from '@aaa/shared';

export type ChatRole = MessageRoleType;
export type TextContentBlock = TextContent;
export type AttachmentRefContentBlock = AttachmentRefContent;
export type ToolResultContentBlock = ToolResultContent;
export type CitationContentBlock = CitationContent;
export type TranscriptContentBlock = TranscriptContent;
export type StatusContentBlock = StatusContent;
export type MessageContentBlock = MessageContent;

export interface ChatMessagePresentation {
  animateText?: boolean;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: MessageContentBlock[];
  createdAt: string;
  presentation?: ChatMessagePresentation;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CitationItem {
  id: string;
  title: string;
  excerpt: string;
  uri?: string;
  sourceId?: string;
}

export interface UploadedAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: 'image' | 'document' | 'audio' | 'file';
  indexedForRag: boolean;
  documentId?: string | null;
}
