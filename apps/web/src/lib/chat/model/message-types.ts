import type {
  AssistantStage,
  AttachmentRefContent,
  CitationContent,
  MessageContent,
  MessageRoleType,
  StatusContent,
  TextContent,
  ThinkingContent,
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
export type ThinkingContentBlock = ThinkingContent;
export type MessageContentBlock = MessageContent;

export type { AssistantStage };

export interface ChatMessagePresentation {
  animateText?: boolean;
  // True while the assistant message is actively streaming over the socket.
  streaming?: boolean;
  // The current pipeline stage for live status display.
  activeStage?: AssistantStage;
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
