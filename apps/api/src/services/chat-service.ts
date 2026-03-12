import { OpenAIProvider, type ChatMessage as ModelChatMessage } from '@aaa/ai';
import { conversationRepository, getPool, messageRepository } from '@aaa/db';
import type { AssistantTextDoneEvent } from '@aaa/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RetrievalCitation } from './retrieval-bridge.js';
import { RetrievalBridge } from './retrieval-bridge.js';
import { broadcast } from '../ws/connections.js';

const DEFAULT_FALLBACK_RESPONSE =
  'I ran into an issue generating a response right now. Please try again.';
const HISTORY_LIMIT = 20;
const MAX_RETRIEVAL_CONTEXT = 6;
const MAX_CITATIONS = 4;

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
    try {
      const completion = await this.modelProvider.complete({
        messages: modelMessages,
        model: process.env['OPENAI_MODEL'],
        temperature: 0.2,
      });
      const generated = completion.content?.trim();
      if (generated) {
        assistantResponse = generated;
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

    const assistantContent: Array<Record<string, unknown>> = [
      { type: 'text', text: assistantResponse },
      ...toCitationContentBlocks(retrieval.citations),
    ];

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

    logger.info({ userId, conversationId: conversation.id }, 'Processing chat message');
    logger.debug(
      {
        conversationId: conversation.id,
        historySize: recentMessages.length,
        attachmentCount: attachmentIds?.length ?? 0,
        retrievalResultCount: retrieval.results.length,
        citationCount: retrieval.citations.length,
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
