import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithTelemetry: vi.fn(),
}));

vi.mock('@aaa/observability', () => ({
  fetchWithTelemetry: mocks.fetchWithTelemetry,
}));

import { exchangeRealtimeSdp, openAiSafetyIdentifier } from './sdp-exchange.js';

describe('openAiSafetyIdentifier', () => {
  it('hashes the user id and does not echo it', () => {
    const identifier = openAiSafetyIdentifier('user-1');
    expect(identifier).toMatch(/^[a-f0-9]{64}$/);
    expect(identifier).not.toContain('user-1');
    expect(openAiSafetyIdentifier('user-1')).toBe(identifier);
  });
});

describe('exchangeRealtimeSdp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the offer and safety identifier and returns the answer SDP', async () => {
    mocks.fetchWithTelemetry.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'answer-sdp',
    });

    const result = await exchangeRealtimeSdp({
      apiKey: 'sk-test',
      userId: 'user-1',
      sdp: 'offer-sdp',
      sessionConfig: { type: 'realtime', model: 'gpt-realtime' },
      telemetry: {
        component: 'voice-service',
        eventPrefix: 'voice.sdp_exchange',
        logResponseBodyOnFailure: true,
      },
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
    expect(init.body.get('session')).toBe(
      JSON.stringify({ type: 'realtime', model: 'gpt-realtime' }),
    );
  });

  it('returns the failure status and body without throwing', async () => {
    mocks.fetchWithTelemetry.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad session',
    });

    await expect(
      exchangeRealtimeSdp({
        apiKey: 'sk-test',
        userId: 'user-1',
        sdp: 'offer-sdp',
        sessionConfig: { type: 'transcription' },
        telemetry: {
          component: 'listener-service',
          eventPrefix: 'listener.sdp_exchange',
          logResponseBodyOnFailure: false,
        },
      }),
    ).resolves.toEqual({ ok: false, status: 400, responseBody: 'bad session' });
  });
});