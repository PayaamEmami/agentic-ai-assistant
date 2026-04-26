import { attachmentRepository } from '@aaa/db';
import type { messageRepository } from '@aaa/db';
import type { AgentHistoryMessage, ChatContentPart } from '@aaa/ai';

type DbMessage = Awaited<ReturnType<typeof messageRepository.listByConversation>>[number];
type DbAttachment = Awaited<ReturnType<typeof attachmentRepository.findById>>;

const MAX_INLINE_ATTACHMENT_TEXT_CHARS = 12_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeToolContent(content: unknown[], options?: { terminalOnly?: boolean }): string {
  const summaries: string[] = [];

  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_result') {
      continue;
    }

    const toolName = typeof block.toolName === 'string' ? block.toolName : 'tool';
    const status = typeof block.status === 'string' ? block.status : 'completed';
    if (
      options?.terminalOnly &&
      status !== 'completed' &&
      status !== 'failed' &&
      status !== 'rejected'
    ) {
      continue;
    }
    const output = 'output' in block ? stringifyValue(block.output) : null;
    summaries.push(
      output ? `Tool ${toolName} ${status}. Output: ${output}` : `Tool ${toolName} ${status}.`,
    );
  }

  return summaries.join('\n').trim();
}

function extractTextFromContent(content: unknown[]): string {
  const parts: string[] = [];

  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }

    const type = typeof block.type === 'string' ? block.type : null;
    if ((type === 'text' || type === 'transcript') && typeof block.text === 'string') {
      parts.push(block.text);
      continue;
    }
  }

  const toolSummary = summarizeToolContent(content, { terminalOnly: true });
  if (toolSummary) {
    parts.push(toolSummary);
  }

  return parts.join('\n').trim();
}

function getAttachmentIdsFromContent(content: unknown[]): string[] {
  const ids: string[] = [];

  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }

    if (block.type === 'attachment_ref' && typeof block.attachmentId === 'string') {
      ids.push(block.attachmentId);
    }
  }

  return ids;
}

function truncateAttachmentText(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= MAX_INLINE_ATTACHMENT_TEXT_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_INLINE_ATTACHMENT_TEXT_CHARS).trimEnd()}\n\n[Attachment text truncated]`;
}

function toAttachmentPromptText(attachment: NonNullable<DbAttachment>): string {
  const header = `Attached file "${attachment.fileName}" (${attachment.mimeType}, attachmentId=${attachment.id})`;

  if (attachment.textContent) {
    return `${header}\n\nExtracted text:\n${truncateAttachmentText(attachment.textContent)}`;
  }

  return `${header}\n\nThis file is available to tools, but its contents are not inlined in the prompt.`;
}

export async function toAgentHistoryMessages(
  messages: DbMessage[],
  userId: string,
): Promise<AgentHistoryMessage[]> {
  const attachmentIds = Array.from(
    new Set(messages.flatMap((message) => getAttachmentIdsFromContent(message.content))),
  );
  const attachments =
    attachmentIds.length > 0
      ? await attachmentRepository.findByIdsForUser(attachmentIds, userId)
      : [];
  const attachmentsById = new Map(
    attachments.map((attachment) => [attachment.id, attachment] as const),
  );

  return messages
    .map<AgentHistoryMessage | null>((message) => {
      if (message.role !== 'user') {
        const text =
          message.role === 'tool'
            ? summarizeToolContent(message.content)
            : extractTextFromContent(message.content);

        if (!text) {
          return null;
        }

        return {
          role: message.role === 'tool' ? 'assistant' : message.role,
          content: text,
        };
      }

      const contentParts: ChatContentPart[] = [];

      for (const block of message.content) {
        if (!isRecord(block)) {
          continue;
        }

        const type = typeof block.type === 'string' ? block.type : null;
        if ((type === 'text' || type === 'transcript') && typeof block.text === 'string') {
          contentParts.push({ type: 'text', text: block.text });
          continue;
        }

        if (type !== 'attachment_ref' || typeof block.attachmentId !== 'string') {
          continue;
        }

        const attachment = attachmentsById.get(block.attachmentId);
        if (!attachment) {
          contentParts.push({
            type: 'text',
            text: `Attached file is unavailable (attachmentId=${block.attachmentId}).`,
          });
          continue;
        }

        if (attachment.kind === 'image') {
          contentParts.push({
            type: 'text',
            text: `Attached image "${attachment.fileName}" (attachmentId=${attachment.id})`,
          });
          contentParts.push({
            type: 'image_url',
            imageUrl: {
              url: `data:${attachment.mimeType};base64,${attachment.data.toString('base64')}`,
              detail: 'auto',
            },
          });
          continue;
        }

        contentParts.push({
          type: 'text',
          text: toAttachmentPromptText(attachment),
        });
      }

      if (contentParts.length === 0) {
        return null;
      }

      return {
        role: 'user',
        content: contentParts,
      };
    })
    .filter((message): message is AgentHistoryMessage => message !== null);
}

export function getLatestUserRequestText(messages: DbMessage[]): string {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  return latestUser ? extractTextFromContent(latestUser.content) : '';
}
