import {
  AgentOrchestrator,
  CodingAgent,
  OpenAIProvider,
  OrchestratorAgent,
  ResearchAgent,
  ToolAgent,
  VerifierAgent,
} from '@aaa/ai';
import {
  approvalRepository,
  attachmentRepository,
  appCapabilityConfigRepository,
  conversationRepository,
  mcpProfileRepository,
  getPool,
  messageRepository,
  toolExecutionRepository,
} from '@aaa/db';
import { getLogContext } from '@aaa/observability';
import {
  type ApprovalRequestedEvent,
  type AssistantInterruptedEvent,
  type AssistantTextDoneEvent,
  type InterruptChatRunResponse,
} from '@aaa/shared';
import type { AppConfig } from '../config.js';
import { loadAvailableTools, type AvailableTool } from './tools-loader.js';
import { buildApprovalDescription } from './tool-call-service.js';
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
import { enqueueToolExecutionJob } from './tool-execution-queue.js';
import { ChatRunRegistry } from './chat-run-registry.js';
import { ChatEventPublisher } from './chat-event-publisher.js';
import { getLatestUserRequestText, toAgentHistoryMessages } from './chat-history.js';

const DEFAULT_FALLBACK_RESPONSE =
  'I ran into an issue generating a response right now. Please try again.';
const HISTORY_LIMIT = 20;
const MAX_RETRIEVAL_CONTEXT = 6;
const TOOL_EXECUTION_RESPONSE = 'I prepared tool calls and started execution where allowed.';
const TOOL_APPROVAL_RESPONSE = 'Review the pending approval request below to continue.';
const MAX_CONVERSATION_TITLE_CHARS = 80;
const INTERRUPTED_STATUS_LABEL = 'Agent stopped';
const USER_CANCELLED_REASON = 'user_cancelled' as const;

type AgentToolCall = { name: string; arguments: Record<string, unknown> };

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.name === 'APIUserAbortError' ||
      error.message === 'Chat run interrupted'
    );
  }

  return false;
}

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

function buildConversationTitle(content: string): string | undefined {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= MAX_CONVERSATION_TITLE_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_CONVERSATION_TITLE_CHARS - 3).trimEnd()}...`;
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

  constructor(options?: {
    config?: AppConfig;
    retrievalBridge?: RetrievalBridge;
    modelProvider?: OpenAIProvider;
    agentOrchestrator?: AgentOrchestrator;
    personalizationService?: PersonalizationService;
    runRegistry?: ChatRunRegistry;
    eventPublisher?: ChatEventPublisher;
  }) {
    const config = options?.config;
    this.retrievalBridge =
      options?.retrievalBridge ??
      new RetrievalBridge(undefined, {
        embeddingModel: config?.openaiEmbeddingModel,
      });
    this.modelProvider =
      options?.modelProvider ??
      new OpenAIProvider(
        config?.openaiApiKey ?? process.env['OPENAI_API_KEY'] ?? '',
        config?.openaiModel ?? process.env['OPENAI_MODEL'],
        config?.openaiEmbeddingModel ?? process.env['OPENAI_EMBEDDING_MODEL'],
      );
    const model = config?.openaiModel ?? process.env['OPENAI_MODEL'];
    this.agentOrchestrator =
      options?.agentOrchestrator ??
      new AgentOrchestrator([
        new OrchestratorAgent(this.modelProvider, model),
        new ResearchAgent(this.modelProvider, model),
        new ToolAgent(this.modelProvider, model),
        new CodingAgent(this.modelProvider, model),
        new VerifierAgent(this.modelProvider, model),
      ]);
    this.personalizationService = options?.personalizationService ?? new PersonalizationService();
    this.runRegistry = options?.runRegistry ?? new ChatRunRegistry();
    this.eventPublisher = options?.eventPublisher ?? new ChatEventPublisher();
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

    let result: SendMessageResult;
    try {
      result = await this.processMessage(userId, content, {
        conversationId,
        attachmentIds,
        clientRunId,
      });
    } finally {
      if (clientRunId) {
        this.runRegistry.finish(clientRunId);
      }
    }

    return {
      conversationId: result.conversationId,
      messageId: result.messageId,
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
  }: AssistantTurnOptions): Promise<SendMessageResult> {
    try {
      throwIfAborted(signal);

      const recentMessages = await messageRepository.listByConversation(
        conversation.id,
        HISTORY_LIMIT,
      );

      if (conversation.title === null && recentMessages.length === 1 && initialConversationTitle) {
        await conversationRepository.updateTitle(conversation.id, initialConversationTitle);
      }

      const messageHistory = await toAgentHistoryMessages(recentMessages, userId);
      throwIfAborted(signal);

      const retrievalDecision = decideRetrieval(requestContent, recentMessages);
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

      const retrieval: RetrievalResponse = retrievalDecision.shouldRetrieve
        ? await this.retrievalBridge.search(requestContent, userId, MAX_RETRIEVAL_CONTEXT, signal)
        : { results: [], citations: [] };
      throwIfAborted(signal);

      const retrievalContext = buildRetrievalContextSections(retrieval);

      const personalContext = await this.personalizationService.getPersonalContext(userId);
      throwIfAborted(signal);

      const activeApps = Array.from(
        new Set(
          (await appCapabilityConfigRepository.listByUser(userId))
            .filter((app) => app.status === 'connected')
            .map((app) => appLabel(app.appKind)),
        ),
      );
      const activeMcpProfiles = (await mcpProfileRepository.listConnectedByUser(userId)).map(
        (profile) => `MCP profile (${profile.integrationKind}): ${profile.profileLabel}`,
      );
      activeApps.push(...activeMcpProfiles);
      throwIfAborted(signal);

      const availableTools = await loadAvailableTools(userId, requestContent);
      throwIfAborted(signal);

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
          retrievedContext: retrievalContext,
          personalContext,
          activeApps,
          signal,
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
      const queuedToolJobs: Array<{
        toolExecutionId: string;
        toolName: string;
        input: Record<string, unknown>;
        conversationId: string;
        correlationId: string;
      }> = [];
      const approvalEvents: ApprovalRequestedEvent[] = [];
      let hasApprovalRequest = false;

      for (const toolCall of toolCalls) {
        throwIfAborted(signal);

        const tool = availableToolsByName.get(toolCall.name);
        if (!tool) {
          continue;
        }

        const toolInput = toolCall.arguments;
        const toolExecution = await toolExecutionRepository.create(
          conversation.id,
          null,
          toolCall.name,
          toolInput,
          tool.origin,
          tool.mcpProfileId ?? null,
          tool.integrationKind ?? null,
          { originMode: 'text' },
        );
        toolExecutionIds.push(toolExecution.id);

        if (tool.requiresApproval) {
          hasApprovalRequest = true;
          await toolExecutionRepository.updateStatus(toolExecution.id, 'requires_approval');
          const approval = await approvalRepository.create(
            userId,
            conversation.id,
            toolExecution.id,
            buildApprovalDescription(tool, toolInput),
          );
          await toolExecutionRepository.setApproval(toolExecution.id, approval.id);

          toolResultBlocks.push({
            type: 'tool_result',
            toolExecutionId: toolExecution.id,
            toolName: toolCall.name,
            status: 'pending',
          });

          approvalEvents.push({
            type: 'approval.requested',
            conversationId: conversation.id,
            approvalId: approval.id,
            toolExecutionId: toolExecution.id,
            description: approval.description,
          });
        } else {
          queuedToolJobs.push({
            toolExecutionId: toolExecution.id,
            toolName: toolCall.name,
            input: toolInput,
            conversationId: conversation.id,
            correlationId:
              getLogContext().correlationId ?? `chat-${conversation.id}-${toolExecution.id}`,
          });

          toolResultBlocks.push({
            type: 'tool_result',
            toolExecutionId: toolExecution.id,
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

      const displayedCitations = selectDisplayedCitations(assistantResponse, retrieval);
      const assistantContent: Array<Record<string, unknown>> = [assistantTextBlock];
      if (toolResultBlocks.length > 0) {
        assistantContent.push(...toolResultBlocks);
      } else {
        assistantContent.push(...toCitationContentBlocks(displayedCitations));
      }

      const assistantMessage = await messageRepository.create(
        conversation.id,
        'assistant',
        assistantContent,
      );
      if (toolExecutionIds.length > 0) {
        await Promise.all(
          toolExecutionIds.map((nextToolExecutionId) =>
            toolExecutionRepository.setMessage(nextToolExecutionId, assistantMessage.id),
          ),
        );
      }
      if (queuedToolJobs.length > 0) {
        await Promise.all(queuedToolJobs.map((job) => enqueueToolExecutionJob(job)));
      }

      const event: AssistantTextDoneEvent = {
        type: 'assistant.text.done',
        conversationId: conversation.id,
        messageId: assistantMessage.id,
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
          historySize: recentMessages.length,
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
        messageId: assistantMessage.id,
        assistantText: assistantResponse,
      };
    } catch (error) {
      if (!signal?.aborted && !isAbortError(error)) {
        throw error;
      }

      return this.createInterruptedMessage(conversation.id, userId);
    }
  }

  private async processMessage(
    userId: string,
    content: string,
    options: SendMessageOptions,
  ): Promise<SendMessageResult> {
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

    return this.generateAssistantTurn({
      conversation,
      userId,
      requestContent: content,
      signal,
      initialConversationTitle,
    });
  }

  private async createInterruptedMessage(
    conversationId: string,
    userId: string,
  ): Promise<SendMessageResult> {
    const interruptedMessage = await messageRepository.create(conversationId, 'assistant', [
      {
        type: 'status',
        status: 'interrupted',
        label: INTERRUPTED_STATUS_LABEL,
      },
    ]);

    const event: AssistantInterruptedEvent = {
      type: 'assistant.interrupted',
      conversationId,
      messageId: interruptedMessage.id,
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
      messageId: interruptedMessage.id,
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
