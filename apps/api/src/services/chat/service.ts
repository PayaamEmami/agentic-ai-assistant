import {
  AgentOrchestrator,
  type ChatProvider,
  CodingAgent,
  createChatProvider,
  OrchestratorAgent,
  ResearchAgent,
  ToolAgent,
  VerifierAgent,
} from '@aaa/ai';
import { openAIProviderModelConfigFromApiConfig } from '@aaa/config';
import { attachmentRepository, conversationRepository, getPool, messageRepository, toolExecutionRepository } from '@aaa/db';
import type { InterruptChatRunResponse } from '@aaa/shared';
import type { AppConfig } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { PersonalizationService } from '../personalization/service.js';
import { RetrievalBridge } from '../retrieval/bridge.js';
import {
  type EnqueueToolExecutionJob,
  enqueueToolExecutionJob as defaultEnqueueToolExecutionJob,
} from '../tools/execution-queue.js';
import {
  deleteConversation as deleteOwnedConversation,
  getConversation as getOwnedConversation,
  listConversations as listOwnedConversations,
  updateConversationTitle as updateOwnedConversationTitle,
} from './conversations.js';
import { ChatRunRegistry } from './run-registry.js';
import { ChatEventPublisher } from './event-publisher.js';
import { getLatestUserRequestText } from './history.js';
import { buildConversationTitle } from './helpers.js';
import {
  CHAT_HISTORY_LIMIT,
  createAssistantPlaceholder,
  generateAssistantTurn,
} from './turn-runner.js';

interface SendMessageOptions {
  conversationId?: string;
  attachmentIds?: string[];
  clientRunId?: string;
}

interface PreparedTurn {
  conversation: {
    id: string;
    title: string | null;
    userId: string;
    isAutomation: boolean;
  };
  signal?: AbortSignal;
  assistantMessageId: string;
  initialConversationTitle?: string;
}

export class ChatService {
  private readonly retrievalBridge: RetrievalBridge;
  private readonly modelProvider: ChatProvider;
  private readonly agentOrchestrator: AgentOrchestrator;
  private readonly personalizationService: PersonalizationService;
  private readonly runRegistry: ChatRunRegistry;
  private readonly eventPublisher: ChatEventPublisher;
  private readonly enqueueToolExecutionJob: EnqueueToolExecutionJob;

  constructor(options: {
    config: AppConfig;
    retrievalBridge?: RetrievalBridge;
    modelProvider?: ChatProvider;
    agentOrchestrator?: AgentOrchestrator;
    personalizationService?: PersonalizationService;
    runRegistry?: ChatRunRegistry;
    eventPublisher?: ChatEventPublisher;
    enqueueToolExecutionJob?: EnqueueToolExecutionJob;
  }) {
    const { config } = options;
    this.retrievalBridge =
      options.retrievalBridge ??
      new RetrievalBridge(config, undefined, {
        embeddingModel: config?.openaiEmbeddingModel,
      });
    this.modelProvider =
      options.modelProvider ??
      createChatProvider(
        config.openaiApiKey,
        openAIProviderModelConfigFromApiConfig(config),
        config.llmChatProvider,
      );
    const model = config.openaiModel;
    this.agentOrchestrator =
      options.agentOrchestrator ??
      new AgentOrchestrator([
        new OrchestratorAgent(this.modelProvider, model),
        new ResearchAgent(this.modelProvider, model),
        new ToolAgent(this.modelProvider, model),
        new CodingAgent(this.modelProvider, model),
        new VerifierAgent(this.modelProvider, model),
      ]);
    this.personalizationService = options.personalizationService ?? new PersonalizationService();
    this.runRegistry = options.runRegistry ?? new ChatRunRegistry();
    this.eventPublisher = options.eventPublisher ?? new ChatEventPublisher();
    this.enqueueToolExecutionJob =
      options.enqueueToolExecutionJob ?? defaultEnqueueToolExecutionJob;
  }

  private turnRunnerDeps() {
    return {
      retrievalBridge: this.retrievalBridge,
      agentOrchestrator: this.agentOrchestrator,
      personalizationService: this.personalizationService,
      eventPublisher: this.eventPublisher,
      enqueueToolExecutionJob: this.enqueueToolExecutionJob,
    };
  }

  async sendMessage(
    userId: string,
    content: string,
    conversationId?: string,
    attachmentIds?: string[],
    clientRunId?: string,
  ) {
    if (clientRunId !== undefined) {
      if (this.runRegistry.get(clientRunId)) {
        throw new AppError(
          409,
          'A chat run with this id is already in progress',
          'RUN_ALREADY_ACTIVE',
        );
      }
      this.runRegistry.start(clientRunId, userId, conversationId);
    }

    // Synchronous preparation (conversation, user message, assistant
    // placeholder) must succeed before responding so the client receives a
    // valid conversation/message id. Failures here surface as HTTP errors.
    let prepared: PreparedTurn;
    try {
      prepared = await this.prepareTurn(userId, content, {
        conversationId,
        attachmentIds,
        clientRunId,
      });
    } catch (error) {
      if (clientRunId) {
        this.runRegistry.finish(clientRunId);
      }
      throw error;
    }

    // Generate the assistant turn asynchronously and stream the result over the
    // WebSocket. The HTTP request returns immediately so the client can render
    // streamed tokens instead of blocking on the full multi-agent pipeline.
    void generateAssistantTurn(this.turnRunnerDeps(), {
      conversation: prepared.conversation,
      userId,
      requestContent: content,
      signal: prepared.signal,
      assistantMessageId: prepared.assistantMessageId,
      initialConversationTitle: prepared.initialConversationTitle,
    })
      .catch((error) => {
        logger.error(
          {
            event: 'chat.turn_failed',
            outcome: 'failure',
            conversationId: prepared.conversation.id,
            error,
          },
          'Assistant turn failed after response was sent',
        );
        this.eventPublisher.error({
          type: 'error',
          conversationId: prepared.conversation.id,
          code: 'ASSISTANT_TURN_FAILED',
          message: 'The assistant ran into an error generating a response.',
        });
      })
      .finally(() => {
        if (clientRunId) {
          this.runRegistry.finish(clientRunId);
        }
      });

    return {
      conversationId: prepared.conversation.id,
      messageId: prepared.assistantMessageId,
    };
  }

  /**
   * Runs a scheduled prompt through the same turn pipeline as a chat message.
   *
   * The caller waits for this turn. If the model calls tools, those jobs continue
   * through the normal tool worker and this method's follow-up turns settle the run.
   */
  async runScheduledPrompt(userId: string, conversationId: string, content: string) {
    const prepared = await this.prepareTurn(userId, content, { conversationId });
    return generateAssistantTurn(this.turnRunnerDeps(), {
      conversation: prepared.conversation,
      userId,
      requestContent: content,
      signal: prepared.signal,
      assistantMessageId: prepared.assistantMessageId,
      initialConversationTitle: prepared.initialConversationTitle,
    });
  }

  async interruptRun(userId: string, runId: string): Promise<InterruptChatRunResponse> {
    const activeRun = this.runRegistry.get(runId);
    if (!activeRun || activeRun.userId !== userId) {
      return { ok: false, status: 'not_found' };
    }

    activeRun.controller.abort(new Error('Chat run interrupted'));
    return {
      ok: true,
      status: 'interrupting',
      conversationId: activeRun.conversationId,
    };
  }

  async continueAfterToolExecution(toolExecutionId: string): Promise<{
    continued: boolean;
    reason?: string;
    conversationId?: string;
    messageId?: string;
  }> {
    const execution = await toolExecutionRepository.findById(toolExecutionId);
    if (!execution) {
      throw new AppError(404, 'Tool execution not found', 'TOOL_EXECUTION_NOT_FOUND');
    }

    if (!execution.messageId) {
      return { continued: false, reason: 'missing_message_binding' };
    }

    if (execution.status !== 'completed' && execution.status !== 'failed') {
      return { continued: false, reason: 'tool_execution_not_terminal' };
    }

    const conversation = await conversationRepository.findById(execution.conversationId);
    if (!conversation) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    const recentMessages = await messageRepository.listByConversation(
      conversation.id,
      CHAT_HISTORY_LIMIT,
    );
    const latestAssistant = [...recentMessages]
      .reverse()
      .find((message) => message.role === 'assistant');
    if (!latestAssistant || latestAssistant.id !== execution.messageId) {
      return { continued: false, reason: 'superseded_by_newer_assistant_message' };
    }

    const groupedExecutions = await toolExecutionRepository.listByMessage(execution.messageId);
    if (
      groupedExecutions.length === 0 ||
      groupedExecutions.some((item) => item.status !== 'completed' && item.status !== 'failed')
    ) {
      return { continued: false, reason: 'tool_group_still_in_progress' };
    }

    // Only one execution in the group may start the follow-up turn. Prefer the
    // lexicographically smallest id so parallel completions cannot double-reply.
    const continuationLeaderId = [...groupedExecutions]
      .map((item) => item.id)
      .sort()[0];
    if (execution.id !== continuationLeaderId) {
      return { continued: false, reason: 'not_continuation_leader' };
    }

    const requestContent = getLatestUserRequestText(recentMessages);
    if (!requestContent) {
      return { continued: false, reason: 'missing_user_request' };
    }

    const result = await generateAssistantTurn(this.turnRunnerDeps(), {
      conversation,
      userId: conversation.userId,
      requestContent,
    });
    return {
      continued: true,
      conversationId: result.conversationId,
      messageId: result.messageId,
    };
  }

  private async prepareTurn(
    userId: string,
    content: string,
    options: SendMessageOptions,
  ): Promise<PreparedTurn> {
    getPool();
    const initialConversationTitle = buildConversationTitle(content);
    const activeRun =
      options.clientRunId !== undefined ? this.runRegistry.get(options.clientRunId) : undefined;
    const signal = activeRun?.controller.signal;

    const conversation =
      options.conversationId === undefined
        ? await conversationRepository.create(userId, initialConversationTitle)
        : await conversationRepository.findById(options.conversationId);

    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    if (activeRun) {
      this.runRegistry.setConversation(options.clientRunId!, conversation.id);
    }

    const attachments = options.attachmentIds?.length
      ? await attachmentRepository.findByIdsForUser(options.attachmentIds, userId)
      : [];
    if ((options.attachmentIds?.length ?? 0) !== attachments.length) {
      throw new AppError(404, 'One or more attachments were not found', 'ATTACHMENT_NOT_FOUND');
    }

    const alreadyAttached = attachments.find((attachment) => attachment.messageId !== null);
    if (alreadyAttached) {
      throw new AppError(
        409,
        'An attachment has already been sent in another message',
        'ATTACHMENT_ALREADY_USED',
      );
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
        const linked = await attachmentRepository.attachToMessage(
          attachment.id,
          userMessage.id,
          userId,
        );
        if (!linked) {
          throw new AppError(
            409,
            `Attachment "${attachment.fileName}" could not be linked to the message`,
            'ATTACHMENT_LINK_FAILED',
          );
        }
      }),
    );

    // Allocate the assistant message up front so streamed deltas have a target.
    const assistantMessageId = await createAssistantPlaceholder(conversation.id);

    return {
      conversation,
      signal,
      assistantMessageId,
      initialConversationTitle,
    };
  }

  async listConversations(userId: string) {
    return listOwnedConversations(userId);
  }

  async updateConversationTitle(userId: string, conversationId: string, title: string) {
    return updateOwnedConversationTitle(userId, conversationId, title);
  }

  async deleteConversation(userId: string, conversationId: string) {
    return deleteOwnedConversation(userId, conversationId);
  }

  async getConversation(userId: string, conversationId: string) {
    return getOwnedConversation(userId, conversationId);
  }
}
