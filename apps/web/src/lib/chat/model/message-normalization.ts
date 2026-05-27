import type { ChatMessage, ChatRole, MessageContentBlock } from './message-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function stringify(value: unknown): string {
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

export function normalizeContentBlock(raw: unknown): MessageContentBlock {
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
