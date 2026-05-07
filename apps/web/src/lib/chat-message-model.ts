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
import type { ConversationSummaryResponse } from './api-client';
import { createClientId } from './uuid';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseRole(role: string): ChatRole {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
    return role;
  }
  return 'assistant';
}

function parseToolStatus(
  value: unknown,
): 'planned' | 'pending' | 'approved' | 'rejected' | 'running' | 'completed' | 'failed' {
  if (
    value === 'planned' ||
    value === 'pending' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed'
  ) {
    return value;
  }
  return 'completed';
}

export function parseApprovalStatus(
  value: unknown,
): 'pending' | 'approved' | 'rejected' | 'expired' {
  if (value === 'pending' || value === 'approved' || value === 'rejected' || value === 'expired') {
    return value;
  }
  return 'pending';
}

function normalizeContentBlock(raw: unknown): MessageContentBlock {
  if (!isRecord(raw)) {
    return { type: 'text', text: String(raw) };
  }

  const type = asString(raw.type);
  if (!type) {
    return {
      type: 'text',
      text: asString(raw.text) ?? stringify(raw),
    };
  }

  if (type === 'text') {
    return { type, text: asString(raw.text) ?? '' };
  }

  if (type === 'attachment_ref') {
    return {
      type,
      attachmentId: asString(raw.attachmentId),
      attachmentKind:
        raw.attachmentKind === 'image' ||
        raw.attachmentKind === 'document' ||
        raw.attachmentKind === 'audio' ||
        raw.attachmentKind === 'file'
          ? raw.attachmentKind
          : undefined,
      mimeType: asString(raw.mimeType),
      fileName: asString(raw.fileName),
      indexedForRag: typeof raw.indexedForRag === 'boolean' ? raw.indexedForRag : undefined,
      documentId: asString(raw.documentId) ?? null,
    };
  }

  if (type === 'tool_result') {
    return {
      type,
      toolExecutionId: asString(raw.toolExecutionId),
      toolName: asString(raw.toolName),
      status: parseToolStatus(raw.status),
      detail: asString(raw.detail),
      output: raw.output,
    };
  }

  if (type === 'citation') {
    return {
      type,
      sourceId: asString(raw.sourceId),
      title: asString(raw.title),
      excerpt: asString(raw.excerpt),
      uri: asString(raw.uri),
    };
  }

  if (type === 'transcript') {
    return {
      type,
      text: asString(raw.text) ?? '',
      durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : undefined,
    };
  }

  if (type === 'status') {
    return {
      type,
      status: 'interrupted',
      label: asString(raw.label),
    };
  }

  return { type: 'text', text: stringify(raw) };
}

export function normalizeMessage(raw: {
  id: string;
  role: string;
  content: unknown[];
  createdAt: string;
}): ChatMessage {
  return {
    id: raw.id,
    role: parseRole(raw.role),
    content: raw.content.map(normalizeContentBlock),
    createdAt: raw.createdAt,
  };
}

export function sortConversations(items: ConversationSummary[]): ConversationSummary[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

export function normalizeConversationSummary(
  conversation: ConversationSummaryResponse,
): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function buildConversationTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Untitled conversation';
  }

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77).trimEnd()}...`;
}

export function upsertConversation(
  conversations: ConversationSummary[],
  conversation: ConversationSummary,
): ConversationSummary[] {
  const next = conversations.filter((item) => item.id !== conversation.id);
  next.push(conversation);
  return sortConversations(next);
}

export function mergeConversations(
  local: ConversationSummary[],
  remote: ConversationSummary[],
): ConversationSummary[] {
  const map = new Map<string, ConversationSummary>();

  for (const item of remote) {
    map.set(item.id, item);
  }

  for (const item of local) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }

  return sortConversations(Array.from(map.values()));
}

export function extractCitations(messages: ChatMessage[]): CitationItem[] {
  const citations: CitationItem[] = [];

  for (const message of messages) {
    message.content.forEach((block, index) => {
      if (block.type !== 'citation') {
        return;
      }

      citations.push({
        id: `${message.id}-${index}`,
        title: block.title ?? block.sourceId ?? 'Source',
        excerpt: block.excerpt ?? '',
        uri: block.uri,
        sourceId: block.sourceId,
      });
    });
  }

  return citations;
}

export function createOptimisticUserMessage(
  content: string,
  attachments: UploadedAttachment[],
): ChatMessage {
  const attachmentBlocks: AttachmentRefContentBlock[] = attachments.map((attachment) => ({
    type: 'attachment_ref',
    attachmentId: attachment.id,
    attachmentKind: attachment.kind,
    mimeType: attachment.mimeType,
    fileName: attachment.name,
    indexedForRag: attachment.indexedForRag,
    documentId: attachment.documentId ?? null,
  }));

  return {
    id: `local-user-${createClientId()}`,
    role: 'user',
    content: [
      {
        type: 'text',
        text: content,
      },
      ...attachmentBlocks,
    ],
    createdAt: new Date().toISOString(),
  };
}

export function createFallbackAssistantMessage(
  messageId: string,
  options: { animateText?: boolean } = {},
): ChatMessage {
  const message: ChatMessage = {
    id: `local-assistant-${messageId}`,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'Assistant response received.',
      },
    ],
    createdAt: new Date().toISOString(),
  };

  if (options.animateText) {
    message.presentation = { animateText: true };
  }

  return message;
}

export function createOptimisticVoiceMessage(
  role: 'user' | 'assistant',
  text: string,
  options: { id?: string; animateText?: boolean } = {},
): ChatMessage {
  const message: ChatMessage = {
    id: options.id ?? `local-voice-${role}-${createClientId()}`,
    role,
    content: [
      {
        type: 'text',
        text,
      },
    ],
    createdAt: new Date().toISOString(),
  };

  if (options.animateText) {
    message.presentation = { animateText: true };
  }

  return message;
}

export function patchMessagesToolResult(
  messages: ChatMessage[],
  toolExecutionId: string | undefined,
  patch: Partial<Pick<ToolResultContentBlock, 'status' | 'detail' | 'output'>>,
): ChatMessage[] {
  if (!toolExecutionId) {
    return messages;
  }

  let changed = false;
  const nextMessages = messages.map((message) => {
    let messageChanged = false;
    const nextContent = message.content.map((block) => {
      if (block.type !== 'tool_result' || block.toolExecutionId !== toolExecutionId) {
        return block;
      }

      messageChanged = true;
      const nextBlock: ToolResultContentBlock = { ...block };

      if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
        if (typeof patch.status === 'undefined') {
          delete nextBlock.status;
        } else {
          nextBlock.status = patch.status;
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'detail')) {
        if (typeof patch.detail === 'undefined') {
          delete nextBlock.detail;
        } else {
          nextBlock.detail = patch.detail;
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'output')) {
        if (typeof patch.output === 'undefined') {
          delete nextBlock.output;
        } else {
          nextBlock.output = patch.output;
        }
      }

      return nextBlock;
    });

    if (!messageChanged) {
      return message;
    }

    changed = true;
    return {
      ...message,
      content: nextContent,
    };
  });

  return changed ? nextMessages : messages;
}
