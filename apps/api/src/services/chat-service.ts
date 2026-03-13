import { OpenAIProvider, type ChatMessage as ModelChatMessage } from '@aaa/ai';
import {
  approvalRepository,
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
const TOOL_ACTION_RESPONSE = 'I prepared tool calls and started execution where allowed.';
const TOOL_APPROVAL_RESPONSE = 'I prepared tool calls and requested approval for protected actions.';

type DbMessage = Awaited<ReturnType<typeof messageRepository.listByConversation>>[number];

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

function toModelMessages(
  messages: DbMessage[],
  retrievalContext: string[],
): ModelChatMessage[] {
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

  const historyMessages: ModelChatMessage[] = messages
    .map((message) => {
      const text = extractTextFromContent(message.content);
      if (!text) {
        return null;
      }

      return {
        role: messageRoleToModelRole(message.role),
        content: text,
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

    const userMessageContent: Array<Record<string, unknown>> = [{ type: 'text', text: content }];
    for (const attachmentId of attachmentIds ?? []) {
      userMessageContent.push({
        type: 'image_ref',
        attachmentId,
      });
    }

    await messageRepository.create(conversation.id, 'user', userMessageContent);

    const recentMessages = await messageRepository.listByConversation(
      conversation.id,
      HISTORY_LIMIT,
    );

    const retrieval = await this.retrievalBridge.search(content, userId, MAX_RETRIEVAL_CONTEXT);
    const retrievalContext = retrieval.results.map((result) => result.content);
    const modelMessages = toModelMessages(recentMessages, retrievalContext);

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
        attachmentCount: attachmentIds?.length ?? 0,
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
