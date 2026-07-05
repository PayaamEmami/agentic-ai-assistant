import crypto from 'node:crypto';
import { type Conversation, conversationRepository, getPool, messageRepository } from '@aaa/db';
import { addLogContext, fetchWithTelemetry, getLogger } from '@aaa/observability';
import type { AssistantInterruptedEvent, AssistantTextDoneEvent } from '@aaa/shared';
import type { AppConfig } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { broadcast } from '../../ws/connections.js';
import { PersonalizationService } from '../personalization/service.js';
import {
  type RetrievalCitation,
  type RetrievalResponse,
  RetrievalBridge,
} from '../retrieval/bridge.js';
import {
  MAX_RETRIEVAL_CONTEXT,
  buildRetrievalContextSections,
  selectDisplayedCitations,
  toCitationContentBlocks,
} from '../retrieval/helpers.js';
import {
  buildRealtimeInstructions,
  buildRealtimeSessionConfig,
  extractMessageText,
  toRealtimeToolName,
} from './realtime-instructions.js';
import { decideRetrieval } from '../retrieval/policy.js';
import { createToolCall } from '../tools/call-service.js';
import {
  type EnqueueToolExecutionJob,
  enqueueToolExecutionJob as defaultEnqueueToolExecutionJob,
} from '../tools/execution-queue.js';
import { loadAvailableTools, type AvailableTool } from '../tools/loader.js';
import { buildConversationTitle } from '../chat/helpers.js';

// Voice keeps a tighter recent-history window than text chat (see chat-service
// HISTORY_LIMIT) to bound realtime prompt size and latency.
const HISTORY_LIMIT = 12;
const PREPARED_TURN_TTL_MS = 5 * 60 * 1000;

interface PreparedTurnCache {
  requestContent: string;
  retrieval: RetrievalResponse;
  preparedAt: number;
}

interface OwnedVoiceTurn {
  assistantMessage: NonNullable<Awaited<ReturnType<typeof messageRepository.findById>>>;
  conversation: Conversation;
}

async function ensureOwnedConversation(
  userId: string,
  conversationId?: string,
): Promise<Conversation> {
  const conversation =
    conversationId === undefined
      ? await conversationRepository.create(userId)
      : await conversationRepository.findById(conversationId);

  if (!conversation || conversation.userId !== userId) {
    throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }

  return conversation;
}

export class VoiceService {
  private readonly personalizationService: PersonalizationService;
  private readonly retrievalBridge: RetrievalBridge;
  private readonly preparedTurns = new Map<string, PreparedTurnCache>();
  private readonly config: AppConfig;
  private readonly enqueueToolExecutionJob: EnqueueToolExecutionJob;

  constructor(
    config: AppConfig,
    personalizationService?: PersonalizationService,
    retrievalBridge?: RetrievalBridge,
    options?: { enqueueToolExecutionJob?: EnqueueToolExecutionJob },
  ) {
    this.personalizationService = personalizationService ?? new PersonalizationService();
    this.retrievalBridge =
      retrievalBridge ??
      new RetrievalBridge(config, undefined, {
        embeddingModel: config.openaiEmbeddingModel,
      });
    this.config = config;
    this.enqueueToolExecutionJob =
      options?.enqueueToolExecutionJob ?? defaultEnqueueToolExecutionJob;
  }

  private cachePreparedTurn(voiceTurnId: string, cache: PreparedTurnCache): void {
    this.preparedTurns.set(voiceTurnId, cache);
    this.pruneExpiredPreparedTurns();
  }

  private pruneExpiredPreparedTurns(): void {
    const now = Date.now();
    for (const [turnId, cache] of this.preparedTurns) {
      if (now - cache.preparedAt > PREPARED_TURN_TTL_MS) {
        this.preparedTurns.delete(turnId);
      }
    }
  }

  private consumePreparedTurn(voiceTurnId: string): PreparedTurnCache | undefined {
    const cache = this.preparedTurns.get(voiceTurnId);
    if (!cache) {
      return undefined;
    }
    this.preparedTurns.delete(voiceTurnId);
    return cache;
  }

  private async assertOwnedVoiceTurn(
    userId: string,
    voiceTurnId: string,
  ): Promise<OwnedVoiceTurn> {
    const assistantMessage = await messageRepository.findById(voiceTurnId);
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

    const conversation = await conversationRepository.findById(assistantMessage.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

    return { assistantMessage, conversation };
  }

  async createSession(userId: string, conversationId?: string) {
    getPool();

    const sessionId = crypto.randomUUID();
    const conversation = await ensureOwnedConversation(userId, conversationId);
    addLogContext({
      correlationId: sessionId,
      voiceSessionId: sessionId,
      userId,
      conversationId: conversation.id,
    });
    const model = this.config.openaiRealtimeModel;
    const voice = this.config.openaiRealtimeVoice;

    getLogger({
      component: 'voice-service',
      voiceSessionId: sessionId,
      conversationId: conversation.id,
      userId,
    }).info(
      {
        event: 'voice.session.started',
        outcome: 'success',
        model,
        voice,
      },
      'Prepared live voice session',
    );

    return {
      sessionId,
      conversationId: conversation.id,
      clientSecret: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      model,
      voice,
    };
  }

  async answerSession(
    userId: string,
    conversationId: string,
    sdp: string,
    sessionId?: string,
  ): Promise<string> {
    getPool();

    const conversation = await ensureOwnedConversation(userId, conversationId);
    if (sessionId) {
      addLogContext({
        correlationId: sessionId,
        voiceSessionId: sessionId,
        userId,
        conversationId: conversation.id,
      });
    }
    const recentMessages = await messageRepository.listByConversation(
      conversation.id,
      HISTORY_LIMIT,
    );
    const [personalContext, availableTools] = await Promise.all([
      this.personalizationService.getPersonalContext(userId).then((value) => value ?? null),
      loadAvailableTools(userId).catch(() => [] as AvailableTool[]),
    ]);
    const model = this.config.openaiRealtimeModel;
    const voice = this.config.openaiRealtimeVoice;
    const transcriptionModel = this.config.openaiTranscriptionModel;
    const instructions = buildRealtimeInstructions(personalContext, recentMessages, availableTools);
    const sessionConfig = buildRealtimeSessionConfig(
      model,
      voice,
      transcriptionModel,
      instructions,
      availableTools,
    );
    const formData = new FormData();
    formData.set('sdp', sdp);
    formData.set('session', JSON.stringify(sessionConfig));

    const response = await fetchWithTelemetry(
      'https://api.openai.com/v1/realtime/calls',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.openaiApiKey}`,
        },
        body: formData,
      },
      {
        component: 'voice-service',
        provider: 'openai',
        eventPrefix: 'voice.sdp_exchange',
        logResponseBodyOnFailure: true,
      },
    );

    if (!response.ok) {
      const responseBody = await response
        .clone()
        .text()
        .catch(() => '');
      getLogger({
        component: 'voice-service',
        voiceSessionId: sessionId,
        conversationId,
        userId,
      }).error(
        {
          event: 'voice.sdp_exchange.failed',
          outcome: 'failure',
          status: response.status,
          responseBody: responseBody.slice(0, 2048),
          sessionConfigSummary: {
            model,
            voice,
            transcriptionModel,
            instructionsLength: instructions.length,
            toolCount: availableTools.length,
            toolNames: availableTools.slice(0, 20).map((tool) => tool.name),
          },
        },
        'Failed to proxy realtime SDP exchange',
      );
      throw new AppError(502, 'Failed to connect live voice session', 'VOICE_SDP_EXCHANGE_FAILED');
    }

    getLogger({
      component: 'voice-service',
      voiceSessionId: sessionId,
      conversationId,
      userId,
    }).info(
      {
        event: 'voice.sdp_exchange.completed',
        outcome: 'success',
      },
      'Realtime SDP exchange completed',
    );
    return response.text();
  }

  async startTurn(userId: string, userTranscript: string, conversationId?: string) {
    getPool();

    const trimmedUserTranscript = userTranscript.trim();
    if (!trimmedUserTranscript) {
      throw new AppError(400, 'userTranscript is required', 'VOICE_TURN_INVALID');
    }

    const conversation = await ensureOwnedConversation(userId, conversationId);
    const existingMessages = await messageRepository.listByConversation(conversation.id, 1);
    if (conversation.title === null && existingMessages.length === 0) {
      const initialTitle = buildConversationTitle(trimmedUserTranscript);
      if (initialTitle) {
        await conversationRepository.updateTitle(conversation.id, initialTitle);
      }
    }

    const userMessage = await messageRepository.create(conversation.id, 'user', [
      { type: 'text', text: trimmedUserTranscript },
    ]);
    const assistantMessage = await messageRepository.create(conversation.id, 'assistant', [
      { type: 'text', text: '' },
    ]);

    getLogger({
      component: 'voice-service',
      userId,
      conversationId: conversation.id,
    }).info(
      {
        event: 'voice.turn.started',
        outcome: 'success',
        voiceTurnId: assistantMessage.id,
        userMessageId: userMessage.id,
        userTranscriptLength: trimmedUserTranscript.length,
      },
      'Started live voice turn',
    );

    return {
      conversationId: conversation.id,
      voiceTurnId: assistantMessage.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
    };
  }

  async prepareTurn(userId: string, voiceTurnId: string, overrideUserTranscript?: string) {
    getPool();

    const { conversation } = await this.assertOwnedVoiceTurn(userId, voiceTurnId);

    const recentMessages = await messageRepository.listByConversation(
      conversation.id,
      HISTORY_LIMIT,
    );

    const requestContent = (() => {
      if (overrideUserTranscript && overrideUserTranscript.trim().length > 0) {
        return overrideUserTranscript.trim();
      }

      for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
        const candidate = recentMessages[index];
        if (candidate && candidate.role === 'user') {
          const extracted = extractMessageText(candidate.content);
          if (extracted.length > 0) {
            return extracted;
          }
        }
      }

      return '';
    })();

    const retrievalDecision = decideRetrieval(requestContent, recentMessages);
    getLogger({
      component: 'voice-service',
      userId,
      conversationId: conversation.id,
    }).debug(
      {
        event: 'voice.retrieval_decided',
        outcome: retrievalDecision.shouldRetrieve ? 'search' : 'skip',
        voiceTurnId,
        reason: retrievalDecision.reason,
        hasRecentCitationContext: retrievalDecision.hasRecentCitationContext,
      },
      'Voice retrieval decision evaluated',
    );

    const retrieval: RetrievalResponse = retrievalDecision.shouldRetrieve
      ? await this.retrievalBridge
          .search(requestContent, userId, MAX_RETRIEVAL_CONTEXT)
          .catch(() => ({ results: [], citations: [] }) as RetrievalResponse)
      : { results: [], citations: [] };

    this.cachePreparedTurn(voiceTurnId, {
      requestContent,
      retrieval,
      preparedAt: Date.now(),
    });

    const [personalContext, availableTools] = await Promise.all([
      this.personalizationService.getPersonalContext(userId).then((value) => value ?? null),
      loadAvailableTools(userId).catch(() => [] as AvailableTool[]),
    ]);

    const retrievalSections = buildRetrievalContextSections(retrieval);
    const instructions = buildRealtimeInstructions(
      personalContext,
      recentMessages,
      availableTools,
      retrievalSections,
    );

    getLogger({
      component: 'voice-service',
      userId,
      conversationId: conversation.id,
    }).info(
      {
        event: 'voice.turn.prepared',
        outcome: 'success',
        voiceTurnId,
        retrievalResultCount: retrieval.results.length,
        requestContentLength: requestContent.length,
      },
      'Prepared voice turn context',
    );

    return {
      voiceTurnId,
      instructions,
      retrievedContext: retrievalSections.length > 0 ? retrievalSections.join('\n\n') : undefined,
      hasRetrieval: retrieval.results.length > 0,
    };
  }

  async updateAssistantText(userId: string, voiceTurnId: string, text: string) {
    getPool();

    await this.assertOwnedVoiceTurn(userId, voiceTurnId);

    await messageRepository.replaceAssistantText(voiceTurnId, text);

    return {
      voiceTurnId,
      assistantMessageId: voiceTurnId,
    };
  }

  async submitToolCall(
    userId: string,
    params: {
      conversationId: string;
      voiceTurnId: string;
      callId: string;
      toolName: string;
      argumentsJson: string;
    },
  ) {
    getPool();

    const { assistantMessage, conversation } = await this.assertOwnedVoiceTurn(
      userId,
      params.voiceTurnId,
    );

    if (assistantMessage.conversationId !== params.conversationId) {
      throw new AppError(400, 'Voice turn does not belong to conversation', 'VOICE_TURN_MISMATCH');
    }

    let toolInput: Record<string, unknown> = {};
    if (params.argumentsJson.trim().length > 0) {
      try {
        const parsed = JSON.parse(params.argumentsJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          toolInput = parsed as Record<string, unknown>;
        } else {
          throw new AppError(
            400,
            'Tool arguments must be a JSON object',
            'VOICE_TOOL_ARGS_INVALID',
          );
        }
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError(400, 'Tool arguments must be valid JSON', 'VOICE_TOOL_ARGS_INVALID');
      }
    }

    const availableTools = await loadAvailableTools(userId).catch(() => [] as AvailableTool[]);
    const tool = availableTools.find(
      (candidate) =>
        candidate.name === params.toolName || toRealtimeToolName(candidate.name) === params.toolName,
    );
    if (!tool) {
      throw new AppError(400, `Unknown tool: ${params.toolName}`, 'VOICE_TOOL_UNKNOWN');
    }

    const creation = await createToolCall({
      conversationId: conversation.id,
      userId,
      tool,
      input: toolInput,
      messageId: params.voiceTurnId,
      originMode: 'voice',
      enqueueToolExecutionJob: this.enqueueToolExecutionJob,
    });

    getLogger({
      component: 'voice-service',
      userId,
      conversationId: conversation.id,
    }).info(
      {
        event: 'voice.tool_call.submitted',
        outcome: 'success',
        voiceTurnId: params.voiceTurnId,
        callId: params.callId,
        toolName: params.toolName,
        toolExecutionId: creation.toolExecutionId,
        status: creation.status,
        requiresApproval: creation.status === 'requires_approval',
      },
      'Submitted voice-origin tool call',
    );

    return {
      toolExecutionId: creation.toolExecutionId,
      status: creation.status === 'requires_approval' ? 'requires_approval' : 'enqueued',
    } as const;
  }

  async interruptSession(
    userId: string,
    sessionId: string,
    conversationId: string,
    voiceTurnId?: string,
  ): Promise<{ conversationId: string }> {
    getPool();

    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    let messageId = voiceTurnId;
    if (messageId) {
      const assistantMessage = await messageRepository.findById(messageId);
      if (
        !assistantMessage ||
        assistantMessage.role !== 'assistant' ||
        assistantMessage.conversationId !== conversation.id
      ) {
        messageId = undefined;
      }
    }

    if (!messageId) {
      const recent = await messageRepository.listByConversation(conversation.id, 1);
      const latest = recent[recent.length - 1];
      if (latest && latest.role === 'assistant') {
        messageId = latest.id;
      }
    }

    if (messageId) {
      const event: AssistantInterruptedEvent = {
        type: 'assistant.interrupted',
        conversationId: conversation.id,
        messageId,
        reason: 'user_cancelled',
      };
      broadcast(conversation.id, event);
    }

    getLogger({
      component: 'voice-service',
      userId,
      conversationId: conversation.id,
      voiceSessionId: sessionId,
    }).info(
      {
        event: 'voice.session.interrupted',
        outcome: 'success',
        voiceSessionId: sessionId,
        voiceTurnId: messageId ?? null,
      },
      'Broadcast voice session interrupt',
    );

    return { conversationId: conversation.id };
  }

  async completeTurn(userId: string, voiceTurnId: string, finalText?: string) {
    getPool();

    const { assistantMessage, conversation } = await this.assertOwnedVoiceTurn(userId, voiceTurnId);

    let assistantText =
      typeof finalText === 'string' ? finalText : extractMessageText(assistantMessage.content);

    if (typeof finalText === 'string') {
      await messageRepository.replaceAssistantText(voiceTurnId, finalText);
      assistantText = finalText;
    }

    const preparedCache = this.consumePreparedTurn(voiceTurnId);
    let citationCount = 0;
    if (preparedCache) {
      const displayedCitations: RetrievalCitation[] = selectDisplayedCitations(
        assistantText,
        preparedCache.retrieval,
      );
      if (displayedCitations.length > 0) {
        await messageRepository.appendContentBlocks(
          voiceTurnId,
          toCitationContentBlocks(displayedCitations),
        );
        citationCount = displayedCitations.length;
      }
    }

    const event: AssistantTextDoneEvent = {
      type: 'assistant.text.done',
      conversationId: conversation.id,
      messageId: voiceTurnId,
      fullText: assistantText,
    };
    broadcast(conversation.id, event);

    getLogger({
      component: 'voice-service',
      userId,
      conversationId: conversation.id,
    }).info(
      {
        event: 'voice.turn.completed',
        outcome: 'success',
        voiceTurnId,
        assistantTextLength: assistantText.length,
        citationCount,
      },
      'Completed live voice turn',
    );

    return {
      conversationId: conversation.id,
      voiceTurnId,
      assistantMessageId: voiceTurnId,
    };
  }
}
