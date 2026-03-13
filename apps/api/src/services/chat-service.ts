import {
  OpenAIProvider,
  type ChatContentPart,
  type ChatMessage as ModelChatMessage,
} from '@aaa/ai';
import {
  approvalRepository,
  attachmentRepository,
  conversationRepository,
  getPool,
  messageRepository,
  toolExecutionRepository,
} from '@aaa/db';
import {
  NATIVE_TOOL_DEFINITIONS,
  type ApprovalRequestedEvent,
  type AssistantTextDoneEvent,
} from '@aaa/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RetrievalCitation } from './retrieval-bridge.js';
import { RetrievalBridge } from './retrieval-bridge.js';
import { enqueueToolExecutionJob } from './tool-execution-queue.js';
import { broadcast } from '../ws/connections.js';

const DEFAULT_FALLBACK_RESPONSE =
  'I ran into an issue generating a response right now. Please try again.';
const HISTORY_LIMIT = 20;
const MAX_RETRIEVAL_CONTEXT = 6;
const MAX_CITATIONS = 4;
const MAX_INLINE_ATTACHMENT_TEXT_CHARS = 12_000;
const TOOL_ACTION_RESPONSE = 'I prepared tool calls and started execution where allowed.';
const TOOL_APPROVAL_RESPONSE = 'I prepared tool calls and requested approval for protected actions.';

type DbMessage = Awaited<ReturnType<typeof messageRepository.listByConversation>>[number];
type DbAttachment = Awaited<ReturnType<typeof attachmentRepository.findById>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function messageRoleToModelRole(role: string): ModelChatMessage['role'] {
  switch (role) {
    case 'system':
    case 'assistant':
    case 'tool':
    case 'user':
      return role;
    default:
      return 'user';
  }
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
    }
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

async function toModelMessages(
  messages: DbMessage[],
  retrievalContext: string[],
  userId: string,
): Promise<ModelChatMessage[]> {
  const systemPrompt: ModelChatMessage = {
    role: 'system',
    content:
      'You are a personal AI assistant. Be concise, accurate, and practical. If context sources are provided, ground your answer in that context and cite sources using [Source n].',
  };

  const contextMessage =
    retrievalContext.length > 0
      ? ({
          role: 'system',
          content: `Relevant context:\n\n${retrievalContext
            .map((item, index) => `[Source ${index + 1}] ${item}`)
            .join('\n\n')}`,
        } as const)
      : null;

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

  const historyMessages = messages
    .map<ModelChatMessage | null>((message) => {
      const role = messageRoleToModelRole(message.role);
      if (role !== 'user') {
        const text = extractTextFromContent(message.content);
        if (!text) {
          return null;
        }

        return {
          role,
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
        role,
        content: contentParts,
      };
    })
    .filter((message): message is ModelChatMessage => message !== null);

  return contextMessage
    ? [systemPrompt, contextMessage, ...historyMessages]
    : [systemPrompt, ...historyMessages];
}

function toCitationContentBlocks(citations: RetrievalCitation[]): Array<Record<string, unknown>> {
  return citations.slice(0, MAX_CITATIONS).map((citation) => ({
    type: 'citation',
    sourceId: citation.sourceId,
    title: citation.documentTitle,
    excerpt: citation.excerpt,
    uri: citation.uri,
    score: citation.score,
  }));
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  if (!argumentsJson.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return { value: parsed };
  } catch {
    return { rawArguments: argumentsJson };
  }
}

function toToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return NATIVE_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export class ChatService {
  private readonly retrievalBridge: RetrievalBridge;
  private readonly modelProvider: OpenAIProvider;

  constructor(retrievalBridge?: RetrievalBridge, modelProvider?: OpenAIProvider) {
    this.retrievalBridge = retrievalBridge ?? new RetrievalBridge();
    this.modelProvider =
      modelProvider ??
      new OpenAIProvider(
        process.env['OPENAI_API_KEY'] ?? '',
        process.env['OPENAI_MODEL'],
        process.env['OPENAI_EMBEDDING_MODEL'],
      );
  }

  async sendMessage(
    userId: string,
    content: string,
    conversationId?: string,
    attachmentIds?: string[],
  ) {
    getPool();

    const conversation =
      conversationId === undefined
        ? await conversationRepository.create(userId)
        : await conversationRepository.findById(conversationId);

    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    const attachments = attachmentIds?.length
      ? await attachmentRepository.findByIdsForUser(attachmentIds, userId)
      : [];
    if ((attachmentIds?.length ?? 0) !== attachments.length) {
      throw new AppError(404, 'One or more attachments were not found', 'ATTACHMENT_NOT_FOUND');
    }

    const alreadyAttached = attachments.find((attachment) => attachment.messageId !== null);
    if (alreadyAttached) {
      throw new AppError(409, 'An attachment has already been sent in another message', 'ATTACHMENT_ALREADY_USED');
    }

    const userMessageContent: Array<Record<string, unknown>> = [{ type: 'text', text: content }];
    for (const attachment of attachments) {
      userMessageContent.push({
        type: 'attachment_ref',
        attachmentId: attachment.id,
        attachmentKind: attachment.kind,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        indexedForRag: attachment.documentId !== null,
        documentId: attachment.documentId,
      });
    }

    const userMessage = await messageRepository.create(conversation.id, 'user', userMessageContent);
    await Promise.all(
      attachments.map(async (attachment) => {
        const linked = await attachmentRepository.attachToMessage(attachment.id, userMessage.id, userId);
        if (!linked) {
          throw new AppError(
            409,
            `Attachment "${attachment.fileName}" could not be linked to the message`,
            'ATTACHMENT_LINK_FAILED',
          );
        }
      }),
    );

    const recentMessages = await messageRepository.listByConversation(
      conversation.id,
      HISTORY_LIMIT,
    );

    const retrieval = await this.retrievalBridge.search(content, userId, MAX_RETRIEVAL_CONTEXT);
    const retrievalContext = retrieval.results.map((result) => result.content);
    const modelMessages = await toModelMessages(recentMessages, retrievalContext, userId);

    let assistantResponse = DEFAULT_FALLBACK_RESPONSE;
    let toolCalls: Array<{ name: string; arguments: string }> = [];
    try {
      const completion = await this.modelProvider.complete({
        messages: modelMessages,
        model: process.env['OPENAI_MODEL'],
        temperature: 0.2,
        tools: toToolDefinitions(),
      });
      toolCalls = completion.toolCalls.map((toolCall) => ({
        name: toolCall.name,
        arguments: toolCall.arguments,
      }));

      const generated = completion.content?.trim() ?? '';
      if (generated) {
        assistantResponse = generated;
      } else if (toolCalls.length > 0) {
        assistantResponse = TOOL_ACTION_RESPONSE;
      }
    } catch (error) {
      logger.error(
        {
          conversationId: conversation.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Assistant generation failed',
      );
    }

    const nativeToolsByName = new Map(
      NATIVE_TOOL_DEFINITIONS.map((tool) => [tool.name, tool] as const),
    );
    const toolResultBlocks: Array<Record<string, unknown>> = [];
    const approvalEvents: ApprovalRequestedEvent[] = [];
    let hasApprovalRequest = false;

    for (const toolCall of toolCalls) {
      const nativeTool = nativeToolsByName.get(toolCall.name);
      if (!nativeTool) {
        continue;
      }

      const toolInput = parseToolArguments(toolCall.arguments);
      const toolExecution = await toolExecutionRepository.create(
        conversation.id,
        null,
        toolCall.name,
        toolInput,
        'native',
      );

      if (nativeTool.requiresApproval) {
        hasApprovalRequest = true;
        await toolExecutionRepository.updateStatus(toolExecution.id, 'requires_approval');
        const approval = await approvalRepository.create(
          userId,
          conversation.id,
          toolExecution.id,
          `Approve execution of tool "${toolCall.name}"`,
        );
        await toolExecutionRepository.setApproval(toolExecution.id, approval.id);

        toolResultBlocks.push({
          type: 'tool_result',
          toolExecutionId: toolExecution.id,
          toolName: toolCall.name,
          status: 'planned',
        });

        approvalEvents.push({
          type: 'approval.requested',
          conversationId: conversation.id,
          approvalId: approval.id,
          toolExecutionId: toolExecution.id,
          description: approval.description,
        });
      } else {
        await enqueueToolExecutionJob({
          toolExecutionId: toolExecution.id,
          toolName: toolCall.name,
          input: toolInput,
          conversationId: conversation.id,
        });

        toolResultBlocks.push({
          type: 'tool_result',
          toolExecutionId: toolExecution.id,
          toolName: toolCall.name,
          status: 'planned',
        });
      }
    }

    if (hasApprovalRequest && toolCalls.length > 0 && assistantResponse === TOOL_ACTION_RESPONSE) {
      assistantResponse = TOOL_APPROVAL_RESPONSE;
    }

    const assistantContent: Array<Record<string, unknown>> = [{ type: 'text', text: assistantResponse }];
    if (toolResultBlocks.length > 0) {
      assistantContent.push(...toolResultBlocks);
    } else {
      assistantContent.push(...toCitationContentBlocks(retrieval.citations));
    }

    const assistantMessage = await messageRepository.create(
      conversation.id,
      'assistant',
      assistantContent,
    );

    const event: AssistantTextDoneEvent = {
      type: 'assistant.text.done',
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      fullText: assistantResponse,
    };

    broadcast(conversation.id, event);
    for (const approvalEvent of approvalEvents) {
      broadcast(conversation.id, approvalEvent);
    }

    logger.info({ userId, conversationId: conversation.id }, 'Processing chat message');
    logger.debug(
      {
        conversationId: conversation.id,
        historySize: recentMessages.length,
        attachmentCount: attachments.length,
        retrievalResultCount: retrieval.results.length,
        citationCount: retrieval.citations.length,
        toolCallCount: toolCalls.length,
        approvalRequestCount: approvalEvents.length,
      },
      'Chat message processed',
    );

    return {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
    };
  }

  async listConversations(userId: string) {
    getPool();
    return conversationRepository.listByUser(userId);
  }

  async getConversation(userId: string, conversationId: string) {
    getPool();

    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    const messages = await messageRepository.listByConversation(conversation.id);

    return {
      id: conversation.id,
      title: conversation.title,
      messages,
    };
  }
}
