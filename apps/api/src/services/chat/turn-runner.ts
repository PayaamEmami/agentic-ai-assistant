import type { AgentOrchestrator } from '@aaa/ai';
import {
  appCapabilityConfigRepository,
  automationRunRepository,
  conversationRepository,
  messageRepository,
  toolExecutionRepository,
} from '@aaa/db';
import { type AssistantInterruptedEvent, type AssistantTextDoneEvent, isAbortError } from '@aaa/shared';
import { noteAutomationTurn } from '../automation/settle-run.js';
import { logger } from '../../lib/logger.js';
import type { RetrievalBridge, RetrievalResponse } from '../retrieval/bridge.js';
import type { PersonalizationService } from '../personalization/service.js';
import { decideRetrieval } from '../retrieval/policy.js';
import {
  MAX_RETRIEVAL_CONTEXT,
  appLabel,
  buildRetrievalContextSections,
  extractExplicitCitationIndexes,
  selectDisplayedCitations,
} from '../retrieval/helpers.js';
import type { EnqueueToolExecutionJob } from '../tools/execution-queue.js';
import { loadAvailableTools, type AvailableTool } from '../tools/loader.js';
import type { ChatEventPublisher } from './event-publisher.js';
import { throwIfAborted } from './helpers.js';
import { toAgentHistoryMessages } from './history.js';
import { createAssistantStreamHooks } from './stream-hooks.js';
import { stageToolCalls } from './tool-staging.js';
import { buildAssistantMessageContent } from './turn-content.js';

export const DEFAULT_FALLBACK_RESPONSE =
  'I ran into an issue generating a response right now. Please try again.';
// Text chat keeps a wider recent-history window than live voice (see
// voice-service HISTORY_LIMIT), which trades latency for richer context.
export const CHAT_HISTORY_LIMIT = 20;
const TOOL_EXECUTION_RESPONSE = 'I prepared tool calls and started execution where allowed.';
const TOOL_APPROVAL_RESPONSE = 'Review the pending approval request below to continue.';
const INTERRUPTED_STATUS_LABEL = 'Agent stopped';
const USER_CANCELLED_REASON = 'user_cancelled' as const;

type AgentToolCall = { name: string; arguments: Record<string, unknown> };

export interface ChatTurnDependencies {
  retrievalBridge: RetrievalBridge;
  agentOrchestrator: AgentOrchestrator;
  personalizationService: PersonalizationService;
  eventPublisher: ChatEventPublisher;
  enqueueToolExecutionJob: EnqueueToolExecutionJob;
}

export interface AssistantTurnOptions {
  conversation: {
    id: string;
    title: string | null;
    isAutomation: boolean;
  };
  userId: string;
  requestContent: string;
  signal?: AbortSignal;
  initialConversationTitle?: string;
  assistantMessageId?: string;
}

export interface SendMessageResult {
  conversationId: string;
  messageId: string;
  assistantText: string;
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

export async function createAssistantPlaceholder(conversationId: string): Promise<string> {
  const placeholder = await messageRepository.create(conversationId, 'assistant', [
    { type: 'text', text: '' },
  ]);
  return placeholder.id;
}

async function createInterruptedMessage(
  eventPublisher: ChatEventPublisher,
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

  eventPublisher.assistantInterrupted(event);
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

export async function generateAssistantTurn(
  deps: ChatTurnDependencies,
  {
    conversation,
    userId,
    requestContent,
    signal,
    initialConversationTitle,
    assistantMessageId: providedAssistantMessageId,
  }: AssistantTurnOptions,
): Promise<SendMessageResult> {
  const assistantMessageId =
    providedAssistantMessageId ?? (await createAssistantPlaceholder(conversation.id));

  try {
    throwIfAborted(signal);

    const recentMessages = await messageRepository.listByConversation(
      conversation.id,
      CHAT_HISTORY_LIMIT,
    );
    // The assistant placeholder is the streaming target and must not be fed
    // back into the model as history.
    const priorMessages = recentMessages.filter((message) => message.id !== assistantMessageId);

    const automationRun = conversation.isAutomation
      ? await automationRunRepository.findActiveByConversation(conversation.id)
      : null;
    if (automationRun) {
      await automationRunRepository.touch(automationRun.id);
    }

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
      ? deps.retrievalBridge.search(requestContent, userId, MAX_RETRIEVAL_CONTEXT, signal)
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
      deps.personalizationService.getPersonalContext(userId),
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

    // Wire streaming callbacks to WebSocket events and accumulate the
    // per-stage "thinking" trace for persistence after streaming completes.
    const { hooks: streamHooks, collectThinkingSegments } = createAssistantStreamHooks(
      deps.eventPublisher,
      conversation.id,
      assistantMessageId,
    );

    if (retrievalDecision.shouldRetrieve) {
      streamHooks.onStage?.('retrieving');
    }

    let assistantResponse = DEFAULT_FALLBACK_RESPONSE;
    let toolCalls: AgentToolCall[] = [];
    let requiresApproval = false;
    let verificationIssues: string[] = [];
    let verificationStatus: 'approved' | 'revise' | null = null;
    try {
      const result = await deps.agentOrchestrator.run({
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
      assistantResponse = normalizeAssistantResponse(result.response, toolCalls, requiresApproval);
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
      throw error;
    }

    const { toolResultBlocks, toolExecutionIds, queuedToolJobs, approvalEvents, hasApprovalRequest } =
      await stageToolCalls({
        conversationId: conversation.id,
        userId,
        toolCalls,
        availableTools,
        signal,
        autoApprove: automationRun !== null,
        enqueueToolExecutionJob: deps.enqueueToolExecutionJob,
      });
    throwIfAborted(signal);

    if (
      hasApprovalRequest &&
      toolCalls.length > 0 &&
      (assistantResponse === TOOL_EXECUTION_RESPONSE ||
        (!assistantResponse.trim() && requiresApproval))
    ) {
      assistantResponse = TOOL_APPROVAL_RESPONSE;
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
    const assistantContent = buildAssistantMessageContent({
      assistantResponse,
      verificationStatus,
      verificationIssues,
      thinkingSegments: collectThinkingSegments(),
      toolResultBlocks,
      displayedCitations,
    });

    await messageRepository.setContent(assistantMessageId, assistantContent);
    if (toolExecutionIds.length > 0) {
      await Promise.all(
        toolExecutionIds.map((nextToolExecutionId) =>
          toolExecutionRepository.setMessage(nextToolExecutionId, assistantMessageId),
        ),
      );
    }
    if (queuedToolJobs.length > 0) {
      await Promise.all(queuedToolJobs.map((job) => deps.enqueueToolExecutionJob(job)));
    }

    const event: AssistantTextDoneEvent = {
      type: 'assistant.text.done',
      conversationId: conversation.id,
      messageId: assistantMessageId,
      fullText: assistantResponse,
    };

    deps.eventPublisher.assistantTextDone(event);
    for (const approvalEvent of approvalEvents) {
      deps.eventPublisher.approvalRequested(approvalEvent);
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

    if (automationRun) {
      await noteAutomationTurn({
        runId: automationRun.id,
        conversationId: conversation.id,
        assistantText: assistantResponse,
        toolNames: queuedToolJobs.map((job) => job.toolName),
      });
    }

    return {
      conversationId: conversation.id,
      messageId: assistantMessageId,
      assistantText: assistantResponse,
    };
  } catch (error) {
    if (!signal?.aborted && !isAbortError(error)) {
      throw error;
    }

    return createInterruptedMessage(deps.eventPublisher, conversation.id, userId, assistantMessageId);
  }
}
