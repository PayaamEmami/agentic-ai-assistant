import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithTelemetry: vi.fn(),
}));

vi.mock('@aaa/observability', () => ({
  fetchWithTelemetry: mocks.fetchWithTelemetry,
}));

import { OpenAIRealtimeProvider, openAiSafetyIdentifier } from './openai-realtime-provider.js';

const telemetry = {
  component: 'voice-service',
  eventPrefix: 'voice.sdp_exchange',
  logResponseBodyOnFailure: true,
};

describe('openAiSafetyIdentifier', () => {
  it('hashes the user id and does not echo it', () => {
    const identifier = openAiSafetyIdentifier('user-1');
    expect(identifier).toMatch(/^[a-f0-9]{64}$/);
    expect(identifier).not.toContain('user-1');
    expect(openAiSafetyIdentifier('user-1')).toBe(identifier);
  });
});

describe('OpenAIRealtimeProvider', () => {
  const provider = new OpenAIRealtimeProvider('sk-test');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps tool names onto realtime function names', () => {
    expect(provider.toolName('time.now')).toBe('time_now');
    expect(provider.toolName('github.get_pull_request')).toBe('github_get_pull_request');
    expect(provider.toolName('tool-name_123')).toBe('tool-name_123');
    expect(provider.toolName('')).toBe('tool');
  });

  it('posts a voice offer with the provider session and safety identifier', async () => {
    mocks.fetchWithTelemetry.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'answer-sdp',
    });

    const result = await provider.connectVoice({
      userId: 'user-1',
      sdp: 'offer-sdp',
      model: 'gpt-realtime',
      voice: 'marin',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      instructions: 'Be brief.',
      tools: [
        {
          name: 'time.now',
          description: 'Current time',
          parameters: { type: 'object', properties: {} },
        },
      ],
      telemetry,
    });

    expect(result).toEqual({ ok: true, answerSdp: 'answer-sdp' });
    expect(mocks.fetchWithTelemetry).toHaveBeenCalledWith(
      'https://api.openai.com/v1/realtime/calls',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'OpenAI-Safety-Identifier': openAiSafetyIdentifier('user-1'),
        },
      }),
      {
        component: 'voice-service',
        provider: 'openai',
        eventPrefix: 'voice.sdp_exchange',
        logResponseBodyOnFailure: true,
      },
    );

    const init = mocks.fetchWithTelemetry.mock.calls[0]?.[1] as { body: FormData };
    expect(init.body.get('sdp')).toBe('offer-sdp');
    expect(JSON.parse(String(init.body.get('session')))).toMatchObject({
      type: 'realtime',
      model: 'gpt-realtime',
      instructions: 'Be brief.',
      tool_choice: 'auto',
      tools: [{ type: 'function', name: 'time_now', description: 'Current time' }],
      audio: { output: { voice: 'marin' } },
    });
  });

  it('posts a transcription-only listener session', async () => {
    mocks.fetchWithTelemetry.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'answer-sdp',
    });

    await provider.connectListener({
      userId: 'user-1',
      sdp: 'offer-sdp',
      model: 'gpt-live-transcribe',
      telemetry: {
        component: 'listener-service',
        eventPrefix: 'listener.sdp_exchange',
        logResponseBodyOnFailure: false,
      },
    });

    const init = mocks.fetchWithTelemetry.mock.calls[0]?.[1] as { body: FormData };
    expect(JSON.parse(String(init.body.get('session')))).toEqual({
      type: 'transcription',
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          transcription: {
            model: 'gpt-live-transcribe',
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
    });
  });

  it('returns the failure status and body without throwing', async () => {
    mocks.fetchWithTelemetry.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad session',
    });

    await expect(
      provider.connectListener({
        userId: 'user-1',
        sdp: 'offer-sdp',
        model: 'gpt-live-transcribe',
        telemetry: {
          component: 'listener-service',
          eventPrefix: 'listener.sdp_exchange',
          logResponseBodyOnFailure: false,
        },
      }),
    ).resolves.toEqual({ ok: false, status: 400, responseBody: 'bad session' });
  });
});
