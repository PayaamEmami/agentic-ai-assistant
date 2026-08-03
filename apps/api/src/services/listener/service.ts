import crypto from 'node:crypto';
import type { ChatProvider } from '@aaa/ai';
import { conversationRepository, getPool, messageRepository } from '@aaa/db';
import { addLogContext, fetchWithTelemetry, getLogger } from '@aaa/observability';
import type {
  ListenerAudioSourceDto,
  ListenerInsightDto,
  ListenerExplainRequest,
  ListenerTranscriptRequest,
} from '@aaa/shared';
import type { AppConfig } from '../../config.js';
import { AppError } from '../../lib/errors.js';

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const TRANSCRIPT_ROLLOVER_CHARS = 12_000;

interface ListenerSession {
  id: string;
  userId: string;
  conversationId: string;
  transcriptMessageId: string;
  source: ListenerAudioSourceDto;
  createdAt: number;
  completedItemIds: Set<string>;
  writeTail: Promise<void>;
}

function listenerTitle(now = new Date()): string {
  return `Listener session - ${now.toISOString().slice(0, 16).replace('T', ' ')}`;
}

function transcriptText(content: unknown[]): { text: string; durationMs?: number } {
  const block = content.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).type === 'transcript',
  ) as Record<string, unknown> | undefined;
  return {
    text: typeof block?.['text'] === 'string' ? block['text'] : '',
    durationMs: typeof block?.['durationMs'] === 'number' ? block['durationMs'] : undefined,
  };
}

export function buildListenerSessionConfig(model: string): Record<string, unknown> {
  return {
    type: 'transcription',
    audio: {
      input: {
        noise_reduction: {
          type: 'near_field',
        },
        transcription: {
          model,
          delay: 'low',
          prompt: 'Educational video, lecture, tutorial, or spoken explanation.',
        },
        turn_detection: {
          type: 'server_vad',
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
        },
      },
    },
  };
}

function insightArray(value: unknown): ListenerInsightDto[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const insights = (value as Record<string, unknown>)['insights'];
  if (!Array.isArray(insights)) {
    return [];
  }
  return insights
    .map((insight) => {
      if (!insight || typeof insight !== 'object' || Array.isArray(insight)) {
        return null;
      }
      const record = insight as Record<string, unknown>;
      const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
      const explanation =
        typeof record['explanation'] === 'string' ? record['explanation'].trim() : '';
      if (!title || !explanation) {
        return null;
      }
      return {
        title: title.slice(0, 160),
        explanation: explanation.slice(0, 8000),
      };
    })
    .filter((insight): insight is ListenerInsightDto => insight !== null)
    .slice(0, 3);
}

export function parseListenerInsights(raw: string | null): ListenerInsightDto[] {
  if (!raw) {
    return [];
  }
  const normalized = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return insightArray(JSON.parse(normalized));
  } catch {
    return [];
  }
}

function explanationPrompt(input: ListenerExplainRequest): string {
  const excluded =
    input.excludedInsights.length > 0
      ? `Do not repeat these insights: ${input.excludedInsights.join(', ')}.`
      : '';
  if (input.mode === 'selection') {
    return [
      `Explain the selected text "${input.selectedText}" using the surrounding transcript.`,
      'Be concise but make the underlying idea understandable to a motivated learner.',
      'Return JSON only: {"insights":[{"title":"...","explanation":"..."}]}.',
      'Return exactly one insight.',
      excluded,
      `Transcript context:\n${input.context}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  return [
    'Identify up to three genuinely non-obvious technical insights in this new transcript window.',
    'Skip common words, names, filler, and ideas that do not need explanation.',
    'If nothing deserves explanation, return {"insights":[]}.',
    'Return JSON only: {"insights":[{"title":"...","explanation":"..."}]}.',
    'Each explanation should be concise, self-contained, and useful while someone keeps watching.',
    excluded,
    `Transcript window:\n${input.context}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function insightsAsMarkdown(insights: ListenerInsightDto[]): string {
  return insights
    .map((insight) => `### ${insight.title}\n\n${insight.explanation}`)
    .join('\n\n');
}

export class ListenerService {
  private readonly sessions = new Map<string, ListenerSession>();
  private readonly autoAnalysisInFlight = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly chatProvider: ChatProvider,
  ) {}

  private pruneSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        this.autoAnalysisInFlight.delete(id);
      }
    }
  }

  private async requireSession(
    userId: string,
    sessionId: string,
    conversationId: string,
  ): Promise<ListenerSession> {
    this.pruneSessions();
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.userId !== userId ||
      session.conversationId !== conversationId
    ) {
      throw new AppError(404, 'Listener session not found', 'LISTENER_SESSION_NOT_FOUND');
    }
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Listener session not found', 'LISTENER_SESSION_NOT_FOUND');
    }
    return session;
  }

  async createSession(userId: string, source: ListenerAudioSourceDto) {
    getPool();
    this.pruneSessions();
    const conversation = await conversationRepository.create(userId, listenerTitle());
    const transcriptMessage = await messageRepository.create(conversation.id, 'user', [
      { type: 'transcript', text: '', durationMs: 0 },
    ]);
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      id: sessionId,
      userId,
      conversationId: conversation.id,
      transcriptMessageId: transcriptMessage.id,
      source,
      createdAt: Date.now(),
      completedItemIds: new Set(),
      writeTail: Promise.resolve(),
    });
    addLogContext({
      correlationId: sessionId,
      userId,
      conversationId: conversation.id,
    });
    getLogger({ component: 'listener-service', userId, conversationId: conversation.id }).info(
      {
        event: 'listener.session.started',
        outcome: 'success',
        source,
        model: this.config.openaiStreamingTranscriptionModel,
      },
      'Started listener session',
    );
    return {
      sessionId,
      conversationId: conversation.id,
      transcriptMessageId: transcriptMessage.id,
      model: this.config.openaiStreamingTranscriptionModel,
    };
  }

  async answerSession(
    userId: string,
    sessionId: string,
    conversationId: string,
    sdp: string,
  ): Promise<string> {
    await this.requireSession(userId, sessionId, conversationId);
    const sessionConfig = buildListenerSessionConfig(
      this.config.openaiStreamingTranscriptionModel,
    );
    const formData = new FormData();
    formData.set('sdp', sdp);
    formData.set('session', JSON.stringify(sessionConfig));
    const safetyIdentifier = crypto.createHash('sha256').update(userId).digest('hex');
    const response = await fetchWithTelemetry(
      'https://api.openai.com/v1/realtime/calls',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.openaiApiKey}`,
          'OpenAI-Safety-Identifier': safetyIdentifier,
        },
        body: formData,
      },
      {
        component: 'listener-service',
        provider: 'openai',
        eventPrefix: 'listener.sdp_exchange',
        logResponseBodyOnFailure: false,
      },
    );
    if (!response.ok) {
      throw new AppError(
        502,
        'Failed to connect listener transcription session',
        'LISTENER_SDP_EXCHANGE_FAILED',
      );
    }
    return response.text();
  }

  async appendTranscript(userId: string, input: ListenerTranscriptRequest) {
    const session = await this.requireSession(userId, input.sessionId, input.conversationId);
    let result = {
      conversationId: input.conversationId,
      transcriptMessageId: session.transcriptMessageId,
      rolledOver: false,
    };
    const operation = session.writeTail.then(async () => {
      if (session.completedItemIds.has(input.itemId)) {
        result = {
          conversationId: input.conversationId,
          transcriptMessageId: session.transcriptMessageId,
          rolledOver: false,
        };
        return;
      }
      const current = await messageRepository.findById(session.transcriptMessageId);
      if (
        !current ||
        current.conversationId !== input.conversationId ||
        current.role !== 'user'
      ) {
        throw new AppError(404, 'Transcript message not found', 'LISTENER_TRANSCRIPT_NOT_FOUND');
      }
      const existing = transcriptText(current.content);
      const nextText = [existing.text.trim(), input.text.trim()].filter(Boolean).join('\n');
      const nextDurationMs = (existing.durationMs ?? 0) + (input.durationMs ?? 0);
      if (existing.text.length > 0 && nextText.length > TRANSCRIPT_ROLLOVER_CHARS) {
        const rolled = await messageRepository.create(input.conversationId, 'user', [
          {
            type: 'transcript',
            text: input.text.trim(),
            durationMs: input.durationMs ?? 0,
          },
        ]);
        session.transcriptMessageId = rolled.id;
        result = {
          conversationId: input.conversationId,
          transcriptMessageId: rolled.id,
          rolledOver: true,
        };
      } else {
        await messageRepository.setContent(current.id, [
          { type: 'transcript', text: nextText, durationMs: nextDurationMs },
        ]);
        result = {
          conversationId: input.conversationId,
          transcriptMessageId: current.id,
          rolledOver: false,
        };
      }
      session.completedItemIds.add(input.itemId);
      getLogger({
        component: 'listener-service',
        userId,
        conversationId: input.conversationId,
      }).debug(
        {
          event: 'listener.transcript.persisted',
          outcome: 'success',
          transcriptLength: input.text.length,
          durationMs: input.durationMs,
          rolledOver: result.rolledOver,
        },
        'Persisted listener transcript segment',
      );
    });
    session.writeTail = operation.then(
      () => undefined,
      () => undefined,
    );
    await operation;
    return result;
  }

  async explain(userId: string, input: ListenerExplainRequest) {
    await this.requireSession(userId, input.sessionId, input.conversationId);
    if (input.mode === 'auto' && this.autoAnalysisInFlight.has(input.sessionId)) {
      throw new AppError(
        409,
        'Automatic listener analysis is already running',
        'LISTENER_ANALYSIS_IN_PROGRESS',
      );
    }
    if (input.mode === 'auto') {
      this.autoAnalysisInFlight.add(input.sessionId);
    }
    const startedAt = Date.now();
    try {
      const completion = await this.chatProvider.complete({
        model: this.config.openaiModel,
        temperature: 0.2,
        maxTokens: 1200,
        messages: [
          {
            role: 'system',
            content:
              'You are a silent learning companion. Explain insights accurately and return only the requested JSON.',
          },
          { role: 'user', content: explanationPrompt(input) },
        ],
      });
      const insights = parseListenerInsights(completion.content);
      const assistantMessage =
        insights.length > 0
          ? await messageRepository.create(input.conversationId, 'assistant', [
              { type: 'text', text: insightsAsMarkdown(insights) },
            ])
          : null;
      getLogger({
        component: 'listener-service',
        userId,
        conversationId: input.conversationId,
      }).info(
        {
          event: 'listener.explanation.completed',
          outcome: 'success',
          mode: input.mode,
          insightCount: insights.length,
          contextLength: input.context.length,
          durationMs: Date.now() - startedAt,
          model: this.config.openaiModel,
        },
        'Completed listener insight explanation',
      );
      return {
        conversationId: input.conversationId,
        messageId: assistantMessage?.id,
        insights,
      };
    } finally {
      if (input.mode === 'auto') {
        this.autoAnalysisInFlight.delete(input.sessionId);
      }
    }
  }
}
