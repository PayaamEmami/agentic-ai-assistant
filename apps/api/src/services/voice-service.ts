import crypto from 'node:crypto';
import { buildSystemPrompt } from '@aaa/ai';
import { type Conversation, conversationRepository, getPool, messageRepository } from '@aaa/db';
import { addLogContext, fetchWithTelemetry, getLogger } from '@aaa/observability';
import type { AssistantTextDoneEvent } from '@aaa/shared';
import { AppError } from '../lib/errors.js';
import { broadcast } from '../ws/connections.js';
import { PersonalizationService } from './personalization-service.js';

const HISTORY_LIMIT = 12;
const MAX_HISTORY_CHARS = 1_800;

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

    if (candidate.type === 'browser_session') {
      const purpose =
        typeof (candidate as { purpose?: unknown }).purpose === 'string'
          ? (candidate as { purpose: string }).purpose
          : 'manual';
      const status =
        typeof (candidate as { status?: unknown }).status === 'string'
          ? (candidate as { status: string }).status
          : 'pending';
      textParts.push(
        `${
          purpose === 'auth'
            ? 'Browser sign-in session'
            : purpose === 'tool_takeover'
              ? 'Browser takeover session'
              : 'Browser session'
        } ${status}`.trim(),
      );
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

function buildRealtimeInstructions(
  personalContext: string | null,
  recentMessages: DbMessage[],
): string {
  const basePrompt = buildSystemPrompt({
    personalContext: personalContext ?? undefined,
  });

  const sections = [
    basePrompt,
    'Live voice mode constraints:',
    '- You are in a realtime spoken conversation.',
    '- Respond naturally, warmly, and conversationally.',
    '- Keep spoken answers concise by default unless the user asks for depth.',
    '- Do not use tools, apps, approvals, web lookup, or retrieval in this mode.',
    '- If a request would normally need tools or external operations, say that live voice is conversational-only and ask the user to switch back to text chat for that task.',
  ];

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
): Record<string, unknown> {
  return {
    type: 'realtime',
    model,
    instructions,
    tool_choice: 'none',
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
          create_response: true,
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

  constructor(personalizationService?: PersonalizationService) {
    this.personalizationService = personalizationService ?? new PersonalizationService();
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
    const recentMessages = await messageRepository.listByConversation(
      conversation.id,
      HISTORY_LIMIT,
    );
    const personalContext = (await this.personalizationService.getPersonalContext(userId)) ?? null;
    const model = process.env['OPENAI_REALTIME_MODEL'] ?? 'gpt-realtime-1.5';
    const voice = process.env['OPENAI_REALTIME_VOICE'] ?? 'marin';
    const instructions = buildRealtimeInstructions(personalContext, recentMessages);
    buildRealtimeSessionConfig(model, voice, instructions);

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
    const personalContext = (await this.personalizationService.getPersonalContext(userId)) ?? null;
    const model = process.env['OPENAI_REALTIME_MODEL'] ?? 'gpt-realtime-1.5';
    const voice = process.env['OPENAI_REALTIME_VOICE'] ?? 'marin';
    const instructions = buildRealtimeInstructions(personalContext, recentMessages);
    const sessionConfig = buildRealtimeSessionConfig(model, voice, instructions);
    const formData = new FormData();
    formData.set('sdp', sdp);
    formData.set('session', JSON.stringify(sessionConfig));

    const response = await fetchWithTelemetry(
      'https://api.openai.com/v1/realtime/calls',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env['OPENAI_API_KEY'] ?? ''}`,
        },
        body: formData,
      },
      {
        component: 'voice-service',
        provider: 'openai',
        eventPrefix: 'voice.sdp_exchange',
        logResponseBodyOnFailure: false,
      },
    );

    if (!response.ok) {
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
    getPool();

    const conversation = await ensureOwnedConversation(userId, conversationId);
    const trimmedUserTranscript = userTranscript.trim();
    const trimmedAssistantTranscript = assistantTranscript.trim();

    if (!trimmedUserTranscript || !trimmedAssistantTranscript) {
      throw new AppError(400, 'Both transcripts are required', 'VOICE_TURN_INVALID');
    }

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
      { type: 'text', text: trimmedAssistantTranscript },
    ]);

    const event: AssistantTextDoneEvent = {
      type: 'assistant.text.done',
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      fullText: trimmedAssistantTranscript,
    };
    broadcast(conversation.id, event);

    getLogger({
      component: 'voice-service',
      userId,
      conversationId: conversation.id,
    }).info(
      {
        event: 'voice.turn.persisted',
        outcome: 'success',
        userTranscriptLength: trimmedUserTranscript.length,
        assistantTranscriptLength: trimmedAssistantTranscript.length,
      },
      'Persisted live voice turn',
    );

    return {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
    };
  }
}
