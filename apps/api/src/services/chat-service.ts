import {
  AgentOrchestrator,
  type AgentStreamHooks,
  CodingAgent,
  OpenAIProvider,
  OrchestratorAgent,
  ResearchAgent,
  ToolAgent,
  VerifierAgent,
} from '@aaa/ai';
import {
  attachmentRepository,
  appCapabilityConfigRepository,
  conversationRepository,
  getPool,
  messageRepository,
  toolExecutionRepository,
} from '@aaa/db';
import {
  type ApprovalRequestedEvent,
  type AssistantInterruptedEvent,
  type AssistantStage,
  type AssistantTextDoneEvent,
  type InterruptChatRunResponse,
} from '@aaa/shared';
import type { AppConfig } from '../config.js';
import { loadAvailableTools, type AvailableTool } from './tools-loader.js';
import { stageToolCall } from './tool-call-service.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RetrievalResponse } from './retrieval-bridge.js';
import { PersonalizationService } from './personalization-service.js';
import { RetrievalBridge } from './retrieval-bridge.js';
import { decideRetrieval } from './retrieval-policy.js';
import {
  appLabel,
  buildRetrievalContextSections,
  extractExplicitCitationIndexes,
  selectDisplayedCitations,
  toCitationContentBlocks,
} from './retrieval-helpers.js';
import {
  type EnqueueToolExecutionJob,
  enqueueToolExecutionJob as defaultEnqueueToolExecutionJob,
} from './tool-execution-queue.js';
import { ChatRunRegistry } from './chat-run-registry.js';
import { ChatEventPublisher } from './chat-event-publisher.js';
import { getLatestUserRequestText, toAgentHistoryMessages } from './chat-history.js';
import { buildConversationTitle, isAbortError } from './chat-service-helpers.js';

const DEFAULT_FALLBACK_RESPONSE =
  'I ran into an issue generating a response right now. Please try again.';
const HISTORY_LIMIT = 20;
const MAX_RETRIEVAL_CONTEXT = 6;
const TOOL_EXECUTION_RESPONSE = 'I prepared tool calls and started execution where allowed.';
const TOOL_APPROVAL_RESPONSE = 'Review the pending approval request below to continue.';
const INTERRUPTED_STATUS_LABEL = 'Agent stopped';
const USER_CANCELLED_REASON = 'user_cancelled' as const;

type AgentToolCall = { name: string; arguments: Record<string, unknown> };

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Chat run interrupted');
  }
}

function toAgentToolContexts(tools: AvailableTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
  }));
}

function normalizeAssistantResponse(
  response: string | null,
  toolCalls: AgentToolCall[],
  requiresApproval: boolean,
): string {
  const trimmed = response?.trim() ?? '';
  if (trimmed) {
    return trimmed;
  }

  if (toolCalls.length === 0) {
    return DEFAULT_FALLBACK_RESPONSE;
  }

  return requiresApproval ? TOOL_APPROVAL_RESPONSE : TOOL_EXECUTION_RESPONSE;
}

interface SendMessageOptions {
  conversationId?: string;
  attachmentIds?: string[];
  clientRunId?: string;
}

interface AssistantTurnOptions {
  conversation: {
    id: string;
    title: string | null;
  };
  userId: string;
  requestContent: string;
  signal?: AbortSignal;
  initialConversationTitle?: string;
  assistantMessageId?: string;
}

interface PreparedTurn {
  conversation: {
    id: string;
    title: string | null;
    userId: string;
  };
  signal?: AbortSignal;
  assistantMessageId: string;
  initialConversationTitle?: string;
}

interface SendMessageResult {
  conversationId: string;
  messageId: string;
  assistantText: string;
}

export class ChatService {
  private readonly retrievalBridge: RetrievalBridge;
  private readonly modelProvider: OpenAIProvider;
  private readonly agentOrchestrator: AgentOrchestrator;
  private readonly personalizationService: PersonalizationService;
  private readonly runRegistry: ChatRunRegistry;
  private readonly eventPublisher: ChatEventPublisher;
  private readonly enqueueToolExecutionJob: EnqueueToolExecutionJob;

  constructor(options: {
    config: AppConfig;
    retrievalBridge?: RetrievalBridge;
    modelProvider?: OpenAIProvider;
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
      new OpenAIProvider(
        config.openaiApiKey,
        config.openaiModel,
        config.openaiEmbeddingModel,
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

  async sendMessage(
    userId: string,
    content: string,
    conversationId?: string,
    attachmentIds?: string[],
    clientRunId?: string,
  ) {
    if (clientRunId !== undefined) {
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
    void this.generateAssistantTurn({
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
      HISTORY_LIMIT,
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

    const requestContent = getLatestUserRequestText(recentMessages);
    if (!requestContent) {
      return { continued: false, reason: 'missing_user_request' };
    }

    const result = await this.generateAssistantTurn({
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

  private async generateAssistantTurn({
    conversation,
    userId,
    requestContent,
    signal,
    initialConversationTitle,
    assistantMessageId: providedAssistantMessageId,
  }: AssistantTurnOptions): Promise<SendMessageResult> {
    const assistantMessageId =
      providedAssistantMessageId ?? (await this.createAssistantPlaceholder(conversation.id));

    try {
      throwIfAborted(signal);

      const recentMessages = await messageRepository.listByConversation(
        conversation.id,
        HISTORY_LIMIT,
      );
      // The assistant placeholder is the streaming target and must not be fed
      // back into the model as history.
      const priorMessages = recentMessages.filter(
        (message) => message.id !== assistantMessageId,
      );

      if (conversation.title === null && priorMessages.length === 1 && initialConversationTitle) {
        await conversationRepository.updateTitle(conversation.id, initialConversationTitle);
      }

      const retrievalDecision = decideRetrieval(requestContent, priorMessages);
      logger.debug(
        {
          event: 'chat.retrieval_decided',
          outcome: retrievalDecision.shouldRetrieve ? 'search' : 'skip',
          conversationId: conversation.id,
          reason: retrievalDecision.reason,
          hasRecentCitationContext: retrievalDecision.hasRecentCitationContext,
        },
        'Retrieval decision evaluated',
      );

      // Kick off retrieval concurrently with orchestrator routing. The
      // orchestrator does not consume retrieved context; only research/verifier
      // do, and they await the provider below.
      const emptyRetrieval: RetrievalResponse = { results: [], citations: [] };
      const retrievalPromise: Promise<RetrievalResponse> = retrievalDecision.shouldRetrieve
        ? this.retrievalBridge.search(requestContent, userId, MAX_RETRIEVAL_CONTEXT, signal)
        : Promise.resolve(emptyRetrieval);
      // Prevent unhandled rejection warnings if retrieval rejects before it is awaited.
      retrievalPromise.catch(() => undefined);

      let cachedRetrieval: RetrievalResponse | undefined;
      const getRetrieval = async (): Promise<RetrievalResponse> => {
        if (!cachedRetrieval) {
          cachedRetrieval = await retrievalPromise;
        }
        return cachedRetrieval;
      };
      const retrievedContextProvider = async (): Promise<string[]> =>
        buildRetrievalContextSections(await getRetrieval());

      // Pre-work that doesn't depend on each other runs in parallel.
      const [messageHistory, personalContext, appConfigs, availableTools] = await Promise.all([
        toAgentHistoryMessages(priorMessages, userId),
        this.personalizationService.getPersonalContext(userId),
        appCapabilityConfigRepository.listByUser(userId),
        loadAvailableTools(userId),
      ]);
      throwIfAborted(signal);

      const activeApps = Array.from(
        new Set(
          appConfigs
            .filter((app) => app.status === 'connected')
            .map((app) => appLabel(app.appKind)),
        ),
      );

      // Accumulate per-stage reasoning so the "thinking" trace can be persisted
      // on the message after streaming completes.
      const thinkingByStage = new Map<AssistantStage, string>();
      const thinkingStageOrder: AssistantStage[] = [];
      const streamHooks: AgentStreamHooks = {
        onStage: (stage) => {
          this.eventPublisher.assistantStatus({
            type: 'assistant.status',
            conversationId: conversation.id,
            messageId: assistantMessageId,
            stage,
          });
        },
        onReasoningDelta: (stage, delta) => {
          if (!delta) {
            return;
          }
          if (!thinkingByStage.has(stage)) {
            thinkingByStage.set(stage, '');
            thinkingStageOrder.push(stage);
          }
          thinkingByStage.set(stage, (thinkingByStage.get(stage) ?? '') + delta);
          this.eventPublisher.assistantThinkingDelta({
            type: 'assistant.thinking.delta',
            conversationId: conversation.id,
            messageId: assistantMessageId,
            stage,
            delta,
          });
        },
        onAnswerDelta: (delta) => {
          if (!delta) {
            return;
          }
          this.eventPublisher.assistantTextDelta({
            type: 'assistant.text.delta',
            conversationId: conversation.id,
            messageId: assistantMessageId,
            delta,
          });
        },
      };
      const collectThinkingSegments = () =>
        thinkingStageOrder
          .map((stage) => ({ stage, text: (thinkingByStage.get(stage) ?? '').trim() }))
          .filter((segment) => segment.text.length > 0);

      if (retrievalDecision.shouldRetrieve) {
        streamHooks.onStage?.('retrieving');
      }

      let assistantResponse = DEFAULT_FALLBACK_RESPONSE;
      let toolCalls: AgentToolCall[] = [];
      let requiresApproval = false;
      let verificationIssues: string[] = [];
      let verificationStatus: 'approved' | 'revise' | null = null;
      try {
        const result = await this.agentOrchestrator.run({
          conversationId: conversation.id,
          userId,
          messageHistory,
          availableTools: toAgentToolContexts(availableTools),
          retrievedContext: [],
          retrievedContextProvider,
          personalContext,
          activeApps,
          signal,
          stream: streamHooks,
        });
        toolCalls = result.toolCalls;
        requiresApproval = result.requiresApproval;
        verificationIssues = result.verification?.issues ?? [];
        verificationStatus = result.verification?.status ?? null;
        assistantResponse = normalizeAssistantResponse(
          result.response,
          toolCalls,
          requiresApproval,
        );
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          throw error;
        }

        logger.error(
          {
            event: 'chat.generation_failed',
            outcome: 'failure',
            conversationId: conversation.id,
            error,
          },
          'Assistant generation failed',
        );
      }

      const availableToolsByName = new Map(
        availableTools.map((tool) => [tool.name, tool] as const),
      );
      const toolResultBlocks: Array<Record<string, unknown>> = [];
      const toolExecutionIds: string[] = [];
      const queuedToolJobs: Array<Parameters<EnqueueToolExecutionJob>[0]> = [];
      const approvalEvents: ApprovalRequestedEvent[] = [];
      let hasApprovalRequest = false;

      for (const toolCall of toolCalls) {
        throwIfAborted(signal);

        const tool = availableToolsByName.get(toolCall.name);
        if (!tool) {
          continue;
        }

        const toolInput = toolCall.arguments;
        const stagedToolCall = await stageToolCall({
          conversationId: conversation.id,
          userId,
          tool,
          input: toolInput,
          messageId: null,
          originMode: 'text',
          enqueueToolExecutionJob: this.enqueueToolExecutionJob,
        });
        toolExecutionIds.push(stagedToolCall.toolExecutionId);

        if (stagedToolCall.status === 'requires_approval') {
          hasApprovalRequest = true;

          toolResultBlocks.push({
            type: 'tool_result',
            toolExecutionId: stagedToolCall.toolExecutionId,
            toolName: toolCall.name,
            status: 'pending',
          });

          if (stagedToolCall.approvalEvent) {
            approvalEvents.push(stagedToolCall.approvalEvent);
          }
        } else if (stagedToolCall.queuedJob) {
          queuedToolJobs.push(stagedToolCall.queuedJob);

          toolResultBlocks.push({
            type: 'tool_result',
            toolExecutionId: stagedToolCall.toolExecutionId,
            toolName: toolCall.name,
            status: 'planned',
          });
        }
      }

      if (
        hasApprovalRequest &&
        toolCalls.length > 0 &&
        (assistantResponse === TOOL_EXECUTION_RESPONSE ||
          (!assistantResponse.trim() && requiresApproval))
      ) {
        assistantResponse = TOOL_APPROVAL_RESPONSE;
      }

      const assistantTextBlock: Record<string, unknown> = { type: 'text', text: assistantResponse };
      if (verificationStatus) {
        assistantTextBlock['verificationStatus'] = verificationStatus;
      }
      if (verificationIssues.length > 0) {
        assistantTextBlock['verificationIssues'] = verificationIssues;
      }

      // Retrieval ran concurrently with the orchestrator; resolve it now for
      // citation display. It already swallows non-abort failures internally.
      let retrieval: RetrievalResponse = emptyRetrieval;
      try {
        retrieval = await getRetrieval();
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          throw error;
        }
      }

      const displayedCitations = selectDisplayedCitations(assistantResponse, retrieval);
      const assistantContent: Array<Record<string, unknown>> = [assistantTextBlock];

      const thinkingSegments = collectThinkingSegments();
      if (thinkingSegments.length > 0) {
        assistantContent.push({ type: 'thinking', segments: thinkingSegments });
      }

      if (toolResultBlocks.length > 0) {
        assistantContent.push(...toolResultBlocks);
      } else {
        assistantContent.push(...toCitationContentBlocks(displayedCitations));
      }

      await messageRepository.setContent(assistantMessageId, assistantContent);
      if (toolExecutionIds.length > 0) {
        await Promise.all(
          toolExecutionIds.map((nextToolExecutionId) =>
            toolExecutionRepository.setMessage(nextToolExecutionId, assistantMessageId),
          ),
        );
      }
      if (queuedToolJobs.length > 0) {
        await Promise.all(queuedToolJobs.map((job) => this.enqueueToolExecutionJob(job)));
      }

      const event: AssistantTextDoneEvent = {
        type: 'assistant.text.done',
        conversationId: conversation.id,
        messageId: assistantMessageId,
        fullText: assistantResponse,
      };

      this.eventPublisher.assistantTextDone(event);
      for (const approvalEvent of approvalEvents) {
        this.eventPublisher.approvalRequested(approvalEvent);
      }

      if (verificationIssues.length > 0) {
        logger.warn(
          {
            event: 'chat.verification_flagged',
            outcome: 'failure',
            conversationId: conversation.id,
            verificationStatus,
            verificationIssues,
          },
          'Verifier revised or flagged the assistant response',
        );
      }

      logger.info(
        {
          event: 'chat.message_completed',
          outcome: 'success',
          userId,
          conversationId: conversation.id,
        },
        'Processing chat message',
      );
      logger.debug(
        {
          event: 'chat.message_processed',
          outcome: 'success',
          conversationId: conversation.id,
          historySize: priorMessages.length,
          retrievalResultCount: retrieval.results.length,
          retrievalCitationCount: retrieval.citations.length,
          displayedCitationCount: displayedCitations.length,
          explicitCitationIndexes: extractExplicitCitationIndexes(assistantResponse),
          toolCallCount: toolCalls.length,
          approvalRequestCount: approvalEvents.length,
          verificationStatus,
          verifierIssueCount: verificationIssues.length,
        },
        'Chat message processed',
      );

      return {
        conversationId: conversation.id,
        messageId: assistantMessageId,
        assistantText: assistantResponse,
      };
    } catch (error) {
      if (!signal?.aborted && !isAbortError(error)) {
        throw error;
      }

      return this.createInterruptedMessage(conversation.id, userId, assistantMessageId);
    }
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
    const assistantMessageId = await this.createAssistantPlaceholder(conversation.id);

    return {
      conversation,
      signal,
      assistantMessageId,
      initialConversationTitle,
    };
  }

  private async createAssistantPlaceholder(conversationId: string): Promise<string> {
    const placeholder = await messageRepository.create(conversationId, 'assistant', [
      { type: 'text', text: '' },
    ]);
    return placeholder.id;
  }

  private async createInterruptedMessage(
    conversationId: string,
    userId: string,
    assistantMessageId?: string,
  ): Promise<SendMessageResult> {
    const interruptedContent = [
      {
        type: 'status',
        status: 'interrupted',
        label: INTERRUPTED_STATUS_LABEL,
      },
    ];

    // Finalize the streaming placeholder in place when one exists; otherwise
    // create a fresh status message (continuation path without a placeholder).
    let messageId: string;
    if (assistantMessageId) {
      await messageRepository.setContent(assistantMessageId, interruptedContent);
      messageId = assistantMessageId;
    } else {
      const interruptedMessage = await messageRepository.create(
        conversationId,
        'assistant',
        interruptedContent,
      );
      messageId = interruptedMessage.id;
    }

    const event: AssistantInterruptedEvent = {
      type: 'assistant.interrupted',
      conversationId,
      messageId,
      reason: USER_CANCELLED_REASON,
    };

    this.eventPublisher.assistantInterrupted(event);
    logger.info(
      {
        event: 'chat.message_interrupted',
        outcome: 'stop',
        userId,
        conversationId,
      },
      'Chat message interrupted by user',
    );

    return {
      conversationId,
      messageId,
      assistantText: '',
    };
  }

  async listConversations(userId: string) {
    getPool();
    return conversationRepository.listByUser(userId);
  }

  async updateConversationTitle(userId: string, conversationId: string, title: string) {
    getPool();

    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new AppError(400, 'Conversation title is required', 'VALIDATION_ERROR');
    }

    const updated = await conversationRepository.updateTitle(conversationId, normalizedTitle);
    if (!updated) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    return updated;
  }

  async deleteConversation(userId: string, conversationId: string) {
    getPool();

    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    const deleted = await conversationRepository.delete(conversationId);
    if (!deleted) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    return { ok: true as const };
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
