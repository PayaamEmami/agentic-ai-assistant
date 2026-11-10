import { describe, expect, it } from 'vitest';
import { createChatProvider, createEmbeddingProvider, createRealtimeProvider } from './provider-factory.js';

const modelConfig = {
  model: 'gpt-test',
  embeddingModel: 'embed-test',
  transcriptionModel: 'transcribe-test',
};

describe('provider factories', () => {
  it('selects the OpenAI implementation for each seam', () => {
    expect(createChatProvider('sk-test', modelConfig, 'openai')).toEqual(
      expect.objectContaining({ complete: expect.any(Function), streamComplete: expect.any(Function) }),
    );
    expect(createEmbeddingProvider('sk-test', modelConfig, 'openai')).toEqual(
      expect.objectContaining({ embed: expect.any(Function) }),
    );
    expect(createRealtimeProvider('sk-test', 'openai')).toEqual(
      expect.objectContaining({
        toolName: expect.any(Function),
        connectVoice: expect.any(Function),
        connectListener: expect.any(Function),
      }),
    );
  });

  it('rejects an unknown provider name', () => {
    expect(() => createChatProvider('sk-test', modelConfig, 'other' as 'openai')).toThrow(
      'Unsupported LLM chat provider: other',
    );
    expect(() => createEmbeddingProvider('sk-test', modelConfig, 'other' as 'openai')).toThrow(
      'Unsupported LLM embedding provider: other',
    );
    expect(() => createRealtimeProvider('sk-test', 'other' as 'openai')).toThrow(
      'Unsupported realtime provider: other',
    );
  });
});
