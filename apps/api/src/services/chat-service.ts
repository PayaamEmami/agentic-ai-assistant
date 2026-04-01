import {
  ActionAgent,
  AgentOrchestrator,
  OpenAIProvider,
  OrchestratorAgent,
  ResearchAgent,
  VerifierAgent,
  type AgentHistoryMessage,
  type ChatContentPart,
} from '@aaa/ai';
import {
  approvalRepository,
  attachmentRepository,
  connectorConfigRepository,
  conversationRepository,
  getPool,
  messageRepository,
  toolExecutionRepository,
} from '@aaa/db';
import { getLogContext } from '@aaa/observability';
import { getConfiguredToolRegistry, type UnifiedToolDescriptor } from '@aaa/mcp';
import {
  NATIVE_TOOL_DEFINITIONS,
  type ApprovalRequestedEvent,
  type AssistantInterruptedEvent,
  type AssistantTextDoneEvent,
  type InterruptChatRunResponse,
} from '@aaa/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RetrievalCitation, RetrievalResponse } from './retrieval-bridge.js';
import { PersonalizationService } from './personalization-service.js';
import { RetrievalBridge } from './retrieval-bridge.js';
import { decideRetrieval } from './retrieval-policy.js';
import { enqueueToolExecutionJob } from './tool-execution-queue.js';
import { broadcast } from '../ws/connections.js';

const DEFAULT_FALLBACK_RESPONSE =
  'I ran into an issue generating a response right now. Please try again.';
const HISTORY_LIMIT = 20;
const MAX_RETRIEVAL_CONTEXT = 6;
const MAX_CITATIONS = 6;
const MAX_INLINE_ATTACHMENT_TEXT_CHARS = 12_000;
const TOOL_ACTION_RESPONSE = 'I prepared tool calls and started execution where allowed.';
const TOOL_APPROVAL_RESPONSE =
  'I prepared tool calls and requested approval for protected actions.';
const MAX_CONVERSATION_TITLE_CHARS = 80;
const INTERRUPTED_STATUS_LABEL = 'Agent stopped';
const USER_CANCELLED_REASON = 'user_cancelled' as const;

interface ActiveChatRun {
  userId: string;
  controller: AbortController;
  conversationId?: string;
}

const activeChatRuns = new Map<string, ActiveChatRun>();

type DbMessage = Awaited<ReturnType<typeof messageRepository.listByConversation>>[number];
type DbAttachment = Awaited<ReturnType<typeof attachmentRepository.findById>>;
type AgentToolCall = { name: string; arguments: Record<string, unknown> };
type AvailableTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  origin: 'native' | 'mcp';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

function summarizeToolContent(content: unknown[]): string {
  const summaries: string[] = [];

  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_result') {
      continue;
    }

    const toolName = typeof block.toolName === 'string' ? block.toolName : 'tool';
    const status = typeof block.status === 'string' ? block.status : 'completed';
    const output = 'output' in block ? stringifyValue(block.output) : null;
    summaries.push(
      output ? `Tool ${toolName} ${status}. Output: ${output}` : `Tool ${toolName} ${status}.`,
    );
  }

  return summaries.join('\n').trim();
}

async function toAgentHistoryMessages(
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

function toNativeAvailableTools(): AvailableTool[] {
  return NATIVE_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
    origin: 'native',
  }));
}

function toAgentToolContexts(tools: AvailableTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
  }));
}

function connectorLabel(kind: string): string {
  switch (kind) {
    case 'github':
      return 'GitHub';
    case 'google_docs':
      return 'Google Docs';
    default:
      return kind;
  }
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

  return requiresApproval ? TOOL_APPROVAL_RESPONSE : TOOL_ACTION_RESPONSE;
}

async function loadAvailableTools(): Promise<AvailableTool[]> {
  const tools = [...toNativeAvailableTools()];

  try {
    const registry = await getConfiguredToolRegistry();
    const mcpTools = registry.listTools().map<AvailableTool>((tool) => toAvailableTool(tool));
    tools.push(...mcpTools);
  } catch {
    // Fall back to native tools only if MCP config is unavailable or startup fails.
  }

  return tools;
}

function toAvailableTool(tool: UnifiedToolDescriptor): AvailableTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
    origin: tool.origin,
  };
}

interface SendMessageOptions {
  conversationId?: string;
  attachmentIds?: string[];
  clientRunId?: string;
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

  constructor(retrievalBridge?: RetrievalBridge, modelProvider?: OpenAIProvider) {
    this.retrievalBridge = retrievalBridge ?? new RetrievalBridge();
    this.modelProvider =
      modelProvider ??
      new OpenAIProvider(
        process.env['OPENAI_API_KEY'] ?? '',
        process.env['OPENAI_MODEL'],
        process.env['OPENAI_EMBEDDING_MODEL'],
      );
    this.agentOrchestrator = new AgentOrchestrator([
      new OrchestratorAgent(this.modelProvider, process.env['OPENAI_MODEL']),
      new ResearchAgent(this.modelProvider, process.env['OPENAI_MODEL']),
      new ActionAgent(this.modelProvider, process.env['OPENAI_MODEL']),
      new VerifierAgent(this.modelProvider, process.env['OPENAI_MODEL']),
    ]);
    this.personalizationService = new PersonalizationService();
  }

  async sendMessage(
    userId: string,
    content: string,
    conversationId?: string,
    attachmentIds?: string[],
    clientRunId?: string,
  ) {
    const activeRun =
      clientRunId !== undefined
        ? {
            userId,
            controller: new AbortController(),
            conversationId,
          }
        : undefined;

    if (clientRunId && activeRun) {
      activeChatRuns.set(clientRunId, activeRun);
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
        activeChatRuns.delete(clientRunId);
      }
    }

    return {
      conversationId: result.conversationId,
      messageId: result.messageId,
    };
  }

  async interruptRun(userId: string, runId: string): Promise<InterruptChatRunResponse> {
    const activeRun = activeChatRuns.get(runId);
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

  private async processMessage(
    userId: string,
    content: string,
    options: SendMessageOptions,
  ): Promise<SendMessageResult> {
    getPool();
    const initialConversationTitle = buildConversationTitle(content);
    const activeRun =
      options.clientRunId !== undefined ? activeChatRuns.get(options.clientRunId) : undefined;
    const signal = activeRun?.controller.signal;

    const conversation =
      options.conversationId === undefined
        ? await conversationRepository.create(userId, initialConversationTitle)
        : await conversationRepository.findById(options.conversationId);

    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    if (activeRun) {
      activeRun.conversationId = conversation.id;
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

      const retrievalDecision = decideRetrieval(content, recentMessages);
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
        ? await this.retrievalBridge.search(
            content,
            userId,
            MAX_RETRIEVAL_CONTEXT,
            signal,
          )
        : { results: [], citations: [] };
      throwIfAborted(signal);

      const retrievalContext = retrieval.results.map((result) => {
        const connectorKind =
          typeof result.metadata.connectorKind === 'string' ? result.metadata.connectorKind : null;
        const lines = [
          `Title: ${result.documentTitle}`,
          connectorKind ? `Connector: ${connectorKind}` : null,
          result.uri ? `URI: ${result.uri}` : null,
          `Content:\n${result.content}`,
        ].filter((line): line is string => line !== null);

        return lines.join('\n');
      });

      const personalContext = await this.personalizationService.getPersonalContext(userId);
      throwIfAborted(signal);

      const activeConnectors = (await connectorConfigRepository.listByUser(userId))
        .filter((connector) => connector.status === 'connected')
        .map((connector) => connectorLabel(connector.kind));
      throwIfAborted(signal);

      const availableTools = await loadAvailableTools();
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
          activeConnectors,
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
        );

        if (tool.requiresApproval) {
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
        (assistantResponse === TOOL_ACTION_RESPONSE ||
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

      const assistantContent: Array<Record<string, unknown>> = [assistantTextBlock];
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
          attachmentCount: attachments.length,
          retrievalResultCount: retrieval.results.length,
          citationCount: retrieval.citations.length,
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

    broadcast(conversationId, event);
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
