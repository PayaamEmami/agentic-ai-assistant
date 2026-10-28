import { setTimeout as delay } from 'node:timers/promises';
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
import {
  approvalRepository,
  attachmentRepository,
  conversationRepository,
  getPool,
  messageRepository,
  toolExecutionRepository,
  type Conversation,
} from '@aaa/db';
import { DEFAULT_NEW_CHAT_MODEL, type ChatModelId, type InterruptChatRunResponse } from '@aaa/shared';
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
  updateConversation as updateOwnedConversation,
} from './conversations.js';
import { ChatRunRegistry } from './run-registry.js';
import { ChatEventPublisher } from './event-publisher.js';
import { getLatestUserRequestText } from './history.js';
import { buildConversationTitle, readMessageText, rewriteUserMessageContent } from './helpers.js';
import {
  CHAT_HISTORY_LIMIT,
  createAssistantPlaceholder,
  generateAssistantTurn,
} from './turn-runner.js';

interface SendMessageOptions {
  conversationId?: string;
  attachmentIds?: string[];
  clientRunId?: string;
  chatModel?: ChatModelId;
}

const DEFAULT_RUN_SETTLE_TIMEOUT_MS = 5_000;
const RUN_SETTLE_POLL_MS = 25;
const RESEND_CANCELLED_OUTPUT = { reason: 'message_resent' };

interface PreparedTurn {
  conversation: {
    id: string;
    title: string | null;
    userId: string;
    isAutomation: boolean;
    chatModel: ChatModelId;
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
  private readonly runSettleTimeoutMs: number;

  constructor(options: {
    config: AppConfig;
    retrievalBridge?: RetrievalBridge;
    modelProvider?: ChatProvider;
    agentOrchestrator?: AgentOrchestrator;
    personalizationService?: PersonalizationService;
    runRegistry?: ChatRunRegistry;
    eventPublisher?: ChatEventPublisher;
    enqueueToolExecutionJob?: EnqueueToolExecutionJob;
    runSettleTimeoutMs?: number;
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
    this.runSettleTimeoutMs = options.runSettleTimeoutMs ?? DEFAULT_RUN_SETTLE_TIMEOUT_MS;
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
    chatModel?: ChatModelId,
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
        chatModel,
      });
    } catch (error) {
      if (clientRunId) {
        this.runRegistry.finish(clientRunId);
      }
      throw error;
    }

    return this.launchAssistantTurn(prepared, userId, content, clientRunId);
  }

  /**
   * Rewrites a user message, deletes every later row, and starts a new turn
   * from that point. Later messages are not kept as a branch.
   */
  async resendFromMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    content: string,
    clientRunId: string,
    chatModel?: ChatModelId,
  ) {
    const text = content.trim();
    if (!text) {
      throw new AppError(400, 'Message content is required', 'VALIDATION_ERROR');
    }

    const conversation = await this.loadResendableConversation(userId, conversationId);
    const target = await messageRepository.findById(messageId);
    if (!target || target.conversationId !== conversation.id) {
      throw new AppError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
    }
    if (target.role !== 'user') {
      throw new AppError(409, 'Only user messages can be edited', 'MESSAGE_NOT_EDITABLE');
    }

    this.runRegistry.abortForConversation(userId, conversation.id);
    const idle = await this.waitForConversationIdle(userId, conversation.id);
    if (!idle) {
      throw new AppError(
        409,
        'This conversation is still stopping. Try again in a moment.',
        'CONVERSATION_BUSY',
      );
    }

    if (this.runRegistry.get(clientRunId)) {
      throw new AppError(
        409,
        'A chat run with this id is already in progress',
        'RUN_ALREADY_ACTIVE',
      );
    }
    this.runRegistry.start(clientRunId, userId, conversation.id);

    let prepared: PreparedTurn;
    try {
      prepared = await this.rewriteAndResume(conversation, messageId, text, clientRunId, chatModel);
    } catch (error) {
      this.runRegistry.finish(clientRunId);
      throw error;
    }

    return this.launchAssistantTurn(prepared, userId, text, clientRunId);
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
        ? await conversationRepository.create(
            userId,
            initialConversationTitle,
            false,
            options.chatModel ?? DEFAULT_NEW_CHAT_MODEL,
          )
        : await conversationRepository.findById(options.conversationId);

    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    if (
      options.conversationId !== undefined &&
      options.chatModel !== undefined &&
      options.chatModel !== conversation.chatModel
    ) {
      const updated = await conversationRepository.update(conversation.id, {
        chatModel: options.chatModel,
      });
      if (!updated) {
        throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
      conversation.chatModel = updated.chatModel;
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

  private launchAssistantTurn(
    prepared: PreparedTurn,
    userId: string,
    requestContent: string,
    clientRunId?: string,
  ) {
    // Generate the assistant turn asynchronously and stream the result over the
    // WebSocket. The HTTP request returns immediately so the client can render
    // streamed tokens instead of blocking on the full multi-agent pipeline.
    void generateAssistantTurn(this.turnRunnerDeps(), {
      conversation: prepared.conversation,
      userId,
      requestContent,
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

  private async loadResendableConversation(userId: string, conversationId: string) {
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }
    if (conversation.isAutomation) {
      throw new AppError(
        409,
        'Automation conversations cannot be edited',
        'AUTOMATION_CONVERSATION',
      );
    }
    return conversation;
  }

  private async waitForConversationIdle(userId: string, conversationId: string): Promise<boolean> {
    const started = Date.now();
    while (this.runRegistry.listForConversation(userId, conversationId).length > 0) {
      if (Date.now() - started >= this.runSettleTimeoutMs) {
        return false;
      }
      await delay(RUN_SETTLE_POLL_MS);
    }
    return true;
  }

  private async rewriteAndResume(
    conversation: Conversation,
    messageId: string,
    text: string,
    clientRunId: string,
    chatModel?: ChatModelId,
  ): Promise<PreparedTurn> {
    const history = await messageRepository.listByConversation(conversation.id);
    const target = history.find((message) => message.id === messageId);
    if (!target || target.role !== 'user') {
      throw new AppError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
    }

    const failedTools = await toolExecutionRepository.failNonTerminalAfter(
      conversation.id,
      target.createdAt,
      target.id,
      RESEND_CANCELLED_OUTPUT,
    );
    await Promise.all(
      failedTools.map(async (execution) => {
        if (execution.approvalId) {
          await approvalRepository.decide(execution.approvalId, 'rejected');
        }
      }),
    );
    await messageRepository.deleteAfter(conversation.id, target.createdAt, target.id);
    await messageRepository.setContent(
      target.id,
      rewriteUserMessageContent(target.content, text),
    );

    const patch: { title?: string; chatModel?: ChatModelId } = {};
    const isFirstMessage = history[0]?.id === target.id;
    const nextTitle = buildConversationTitle(text);
    const previousTitle = buildConversationTitle(readMessageText(target.content));
    if (
      isFirstMessage &&
      nextTitle &&
      previousTitle &&
      conversation.title === previousTitle &&
      conversation.title !== nextTitle
    ) {
      patch.title = nextTitle;
    }
    if (chatModel !== undefined && chatModel !== conversation.chatModel) {
      patch.chatModel = chatModel;
    }
    let currentConversation = conversation;
    if (patch.title !== undefined || patch.chatModel !== undefined) {
      const updated = await conversationRepository.update(conversation.id, patch);
      if (!updated) {
        throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
      currentConversation = updated;
    }

    const assistantMessageId = await createAssistantPlaceholder(currentConversation.id);
    const activeRun = this.runRegistry.get(clientRunId);

    return {
      conversation: currentConversation,
      signal: activeRun?.controller.signal,
      assistantMessageId,
      initialConversationTitle:
        currentConversation.title === null ? buildConversationTitle(text) : undefined,
    };
  }

  async listConversations(userId: string) {
    return listOwnedConversations(userId);
  }

  async updateConversation(
    userId: string,
    conversationId: string,
    patch: { title?: string; chatModel?: ChatModelId },
  ) {
    return updateOwnedConversation(userId, conversationId, patch);
  }

  async deleteConversation(userId: string, conversationId: string) {
    return deleteOwnedConversation(userId, conversationId);
  }

  async getConversation(userId: string, conversationId: string) {
    return getOwnedConversation(userId, conversationId);
  }
}
