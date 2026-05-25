import { createClientId } from '../../uuid';
import type {
  AttachmentRefContentBlock,
  ChatMessage,
  UploadedAttachment,
} from './chat-message-types';

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
  return createAssistantTextMessage(
    `local-assistant-${messageId}`,
    'Assistant response received.',
    options,
  );
}

export function createErrorAssistantMessage(
  message: string,
  options: { animateText?: boolean } = {},
): ChatMessage {
  return createAssistantTextMessage(`local-error-${createClientId()}`, `Error: ${message}`, options);
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

function createAssistantTextMessage(
  id: string,
  text: string,
  options: { animateText?: boolean },
): ChatMessage {
  const message: ChatMessage = {
    id,
    role: 'assistant',
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
