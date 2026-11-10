import crypto from 'node:crypto';
import { fetchWithTelemetry } from '@aaa/observability';
import type {
  RealtimeExchangeResult,
  RealtimeListenerConnectInput,
  RealtimeProvider,
  RealtimeTool,
  RealtimeVoiceConnectInput,
} from './realtime-provider.js';

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

/** Stable per-user id sent as OpenAI-Safety-Identifier. The raw user id is not sent. */
export function openAiSafetyIdentifier(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex');
}

export class OpenAIRealtimeProvider implements RealtimeProvider {
  constructor(private readonly apiKey: string) {}

  toolName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool';
  }

  connectVoice(input: RealtimeVoiceConnectInput): Promise<RealtimeExchangeResult> {
    return this.exchange(input.userId, input.sdp, voiceSessionConfig(this, input), input.telemetry);
  }

  connectListener(input: RealtimeListenerConnectInput): Promise<RealtimeExchangeResult> {
    return this.exchange(input.userId, input.sdp, listenerSessionConfig(input.model), input.telemetry);
  }

  private async exchange(
    userId: string,
    sdp: string,
    sessionConfig: Record<string, unknown>,
    telemetry: RealtimeVoiceConnectInput['telemetry'],
  ): Promise<RealtimeExchangeResult> {
    const formData = new FormData();
    formData.set('sdp', sdp);
    formData.set('session', JSON.stringify(sessionConfig));

    const response = await fetchWithTelemetry(
      OPENAI_REALTIME_CALLS_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'OpenAI-Safety-Identifier': openAiSafetyIdentifier(userId),
        },
        body: formData,
      },
      {
        component: telemetry.component,
        provider: 'openai',
        eventPrefix: telemetry.eventPrefix,
        logResponseBodyOnFailure: telemetry.logResponseBodyOnFailure,
      },
    );

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      return { ok: false, status: response.status, responseBody };
    }

    return { ok: true, answerSdp: await response.text() };
  }
}

function voiceSessionConfig(
  provider: OpenAIRealtimeProvider,
  input: RealtimeVoiceConnectInput,
): Record<string, unknown> {
  const hasTools = input.tools.length > 0;
  return {
    type: 'realtime',
    model: input.model,
    instructions: input.instructions,
    tools: hasTools ? input.tools.map((tool) => voiceTool(provider, tool)) : [],
    tool_choice: hasTools ? 'auto' : 'none',
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        transcription: { model: input.transcriptionModel },
        turn_detection: {
          type: 'server_vad',
          create_response: false,
          interrupt_response: true,
          prefix_padding_ms: 300,
          silence_duration_ms: 3000,
        },
      },
      output: { voice: input.voice },
    },
  };
}

function voiceTool(
  provider: OpenAIRealtimeProvider,
  tool: RealtimeTool,
): Record<string, unknown> {
  return {
    type: 'function',
    name: provider.toolName(tool.name),
    description: tool.description,
    parameters: tool.parameters,
  };
}

function listenerSessionConfig(model: string): Record<string, unknown> {
  return {
    type: 'transcription',
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
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
