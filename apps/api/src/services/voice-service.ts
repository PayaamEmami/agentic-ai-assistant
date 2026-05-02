import crypto from 'node:crypto';
import { buildSystemPrompt, type PromptToolContext } from '@aaa/ai';
import { type Conversation, conversationRepository, getPool, messageRepository } from '@aaa/db';
import { addLogContext, fetchWithTelemetry, getLogger } from '@aaa/observability';
import type { AssistantInterruptedEvent, AssistantTextDoneEvent } from '@aaa/shared';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { broadcast } from '../ws/connections.js';
import { PersonalizationService } from './personalization-service.js';
import {
  type RetrievalCitation,
  type RetrievalResponse,
  RetrievalBridge,
} from './retrieval-bridge.js';
import {
  buildRetrievalContextSections,
  selectDisplayedCitations,
  toCitationContentBlocks,
} from './retrieval-helpers.js';
import { decideRetrieval } from './retrieval-policy.js';
import { createToolCall } from './tool-call-service.js';
import { loadAvailableTools, type AvailableTool } from './tools-loader.js';

const HISTORY_LIMIT = 12;
const MAX_HISTORY_CHARS = 1_800;
const MAX_RETRIEVAL_CONTEXT = 6;
const PREPARED_TURN_TTL_MS = 5 * 60 * 1000;

interface PreparedTurnCache {
  requestContent: string;
  retrieval: RetrievalResponse;
  preparedAt: number;
}

type DbMessage = Awaited<ReturnType<typeof messageRepository.listByConversation>>[number];

function extractMessageText(content: unknown[]): string {
  const textParts: string[] = [];

  for (const block of content) {
    if (typeof block !== 'object' || block === null) {
      continue;
    }

    const candidate = block as { type?: unknown; text?: unknown };
    if (
      (candidate.type === 'text' || candidate.type === 'transcript') &&
      typeof candidate.text === 'string'
    ) {
      textParts.push(candidate.text.trim());
      continue;
    }
  }

  return textParts.filter(Boolean).join('\n').trim();
}

function summarizeHistory(messages: DbMessage[]): string {
  const historyLines = messages
    .map((message) => {
      const text = extractMessageText(message.content);
      if (!text) {
        return null;
      }

      const speaker =
        message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'User' : null;

      if (!speaker) {
        return null;
      }

      return `${speaker}: ${text.replace(/\s+/g, ' ').trim()}`;
    })
    .filter((line): line is string => line !== null);

  if (historyLines.length === 0) {
    return '';
  }

  const joined = historyLines.join('\n');
  if (joined.length <= MAX_HISTORY_CHARS) {
    return joined;
  }

  return joined.slice(joined.length - MAX_HISTORY_CHARS).trimStart();
}

function buildConversationTitle(content: string): string | undefined {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77).trimEnd()}...`;
}

export function toRealtimeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool';
}

function toRealtimePromptToolContexts(tools: AvailableTool[]): PromptToolContext[] {
  return tools.map((tool) => ({
    name: toRealtimeToolName(tool.name),
    description: tool.description,
    requiresApproval: tool.requiresApproval,
  }));
}

function toRealtimeToolDefinitions(tools: AvailableTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    name: toRealtimeToolName(tool.name),
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function buildRealtimeInstructions(
  personalContext: string | null,
  recentMessages: DbMessage[],
  availableTools: AvailableTool[],
  retrievalContextSections: string[] = [],
): string {
  const hasTools = availableTools.length > 0;
  const hasRetrieval = retrievalContextSections.length > 0;
  const basePrompt = buildSystemPrompt({
    personalContext: personalContext ?? undefined,
    availableTools: hasTools ? toRealtimePromptToolContexts(availableTools) : undefined,
    includeToolGuidance: hasTools,
    includeRetrievalGuidance: hasRetrieval,
  });

  const sections = [
    basePrompt,
    'Live voice mode constraints:',
    '- You are in a realtime spoken conversation.',
    '- Respond naturally, warmly, and conversationally.',
    '- Keep spoken answers concise by default unless the user asks for depth.',
    hasTools
      ? '- You may invoke the available tools when the user asks for something that requires them. Tools marked as requiring approval will pause the conversation until the user responds in the UI; acknowledge briefly and wait for their decision.'
      : '- No tools are available this session; if a request requires tools, say so and offer to continue in text chat.',
  ];

  if (hasRetrieval) {
    const numbered = retrievalContextSections
      .map((section, index) => `[${index + 1}] ${section}`)
      .join('\n\n');
    sections.push(
      `Retrieved context for this turn (cite as [Source N] only when you use the content):\n${numbered}`,
    );
  }

  const historySummary = summarizeHistory(recentMessages);
  if (historySummary) {
    sections.push(`Recent conversation context:\n${historySummary}`);
  }

  return sections.join('\n\n');
}

function buildRealtimeSessionConfig(
  model: string,
  voice: string,
  instructions: string,
  tools: AvailableTool[],
): Record<string, unknown> {
  const hasTools = tools.length > 0;
  return {
    type: 'realtime',
    model,
    instructions,
    tools: hasTools ? toRealtimeToolDefinitions(tools) : [],
    tool_choice: hasTools ? 'auto' : 'none',
    audio: {
      input: {
        noise_reduction: {
          type: 'near_field',
        },
        transcription: {
          model: 'gpt-4o-mini-transcribe',
        },
        turn_detection: {
          type: 'server_vad',
          create_response: false,
          interrupt_response: true,
          prefix_padding_ms: 300,
          silence_duration_ms: 450,
        },
      },
      output: {
        voice,
      },
    },
  };
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
  private readonly config?: AppConfig;

  constructor(
    personalizationService?: PersonalizationService,
    retrievalBridge?: RetrievalBridge,
    options?: { config?: AppConfig },
  ) {
    this.personalizationService = personalizationService ?? new PersonalizationService();
    this.retrievalBridge =
      retrievalBridge ??
      new RetrievalBridge(undefined, {
        embeddingModel: options?.config?.openaiEmbeddingModel,
      });
    this.config = options?.config;
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
    const model =
      this.config?.openaiRealtimeModel ??
      process.env['OPENAI_REALTIME_MODEL'] ??
      'gpt-realtime-1.5';
    const voice =
      this.config?.openaiRealtimeVoice ?? process.env['OPENAI_REALTIME_VOICE'] ?? 'marin';

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
    const model =
      this.config?.openaiRealtimeModel ??
      process.env['OPENAI_REALTIME_MODEL'] ??
      'gpt-realtime-1.5';
    const voice =
      this.config?.openaiRealtimeVoice ?? process.env['OPENAI_REALTIME_VOICE'] ?? 'marin';
    const instructions = buildRealtimeInstructions(personalContext, recentMessages, availableTools);
    const sessionConfig = buildRealtimeSessionConfig(model, voice, instructions, availableTools);
    const formData = new FormData();
    formData.set('sdp', sdp);
    formData.set('session', JSON.stringify(sessionConfig));

    const response = await fetchWithTelemetry(
      'https://api.openai.com/v1/realtime/calls',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config?.openaiApiKey ?? process.env['OPENAI_API_KEY'] ?? ''}`,
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

  async persistTurn(
    userId: string,
    userTranscript: string,
    assistantTranscript: string,
    conversationId?: string,
  ) {
    const trimmedUserTranscript = userTranscript.trim();
    const trimmedAssistantTranscript = assistantTranscript.trim();

    if (!trimmedUserTranscript || !trimmedAssistantTranscript) {
      throw new AppError(400, 'Both transcripts are required', 'VOICE_TURN_INVALID');
    }

    const started = await this.startTurn(userId, trimmedUserTranscript, conversationId);

    try {
      await this.updateAssistantText(userId, started.voiceTurnId, trimmedAssistantTranscript);
    } catch (error) {
      getLogger({
        component: 'voice-service',
        userId,
        conversationId: started.conversationId,
      }).warn(
        {
          event: 'voice.turn.assistant_text_update_failed',
          outcome: 'failure',
          voiceTurnId: started.voiceTurnId,
          error,
        },
        'Failed to update assistant text on legacy persistTurn',
      );
    }

    const completed = await this.completeTurn(
      userId,
      started.voiceTurnId,
      trimmedAssistantTranscript,
    );

    return {
      conversationId: completed.conversationId,
      userMessageId: started.userMessageId,
      assistantMessageId: completed.assistantMessageId,
    };
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

    const assistantMessage = await messageRepository.findById(voiceTurnId);
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

    const conversation = await conversationRepository.findById(assistantMessage.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

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

    const assistantMessage = await messageRepository.findById(voiceTurnId);
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

    const conversation = await conversationRepository.findById(assistantMessage.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

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

    const assistantMessage = await messageRepository.findById(params.voiceTurnId);
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

    if (assistantMessage.conversationId !== params.conversationId) {
      throw new AppError(400, 'Voice turn does not belong to conversation', 'VOICE_TURN_MISMATCH');
    }

    const conversation = await conversationRepository.findById(assistantMessage.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
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

    const assistantMessage = await messageRepository.findById(voiceTurnId);
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

    const conversation = await conversationRepository.findById(assistantMessage.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Voice turn not found', 'VOICE_TURN_NOT_FOUND');
    }

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
