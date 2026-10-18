import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  responsesCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: mocks.chatCreate } };
    responses = { create: mocks.responsesCreate };
  },
}));

import { OpenAIProvider } from './openai-provider.js';

const tool = {
  name: 'time.now',
  description: 'Get the time',
  parameters: { type: 'object' },
};

function provider() {
  return new OpenAIProvider('test-key', {
    model: 'gpt-5.6-luna',
    embeddingModel: 'text-embedding-3-small',
    transcriptionModel: 'gpt-4o-mini-transcribe',
  });
}

describe('OpenAIProvider chat routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-5.6-luna';
    process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.OPENAI_TRANSCRIPTION_STANDARD_MODEL = 'gpt-4o-mini-transcribe';
    mocks.responsesCreate.mockResolvedValue({
      id: 'resp-1',
      output_text: 'done',
      output: [],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    mocks.chatCreate.mockResolvedValue({
      id: 'cmpl-1',
      choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });

  it('sends Sol function tools through the Responses API', async () => {
    await provider().complete({
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'Run the tool' }],
      tools: [tool],
    });

    expect(mocks.chatCreate).not.toHaveBeenCalled();
    expect(mocks.responsesCreate).toHaveBeenCalledTimes(1);
    const body = mocks.responsesCreate.mock.calls[0]?.[0] as {
      reasoning?: { effort: string };
      tools: Array<{ type: string }>;
    };
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.tools.some((item) => item.type === 'web_search')).toBe(false);
    expect(body.tools.some((item) => item.type === 'function')).toBe(true);
  });

  it('keeps Luna function tools on Chat Completions', async () => {
    await provider().complete({
      model: 'gpt-6-luna',
      messages: [{ role: 'user', content: 'Run the tool' }],
      tools: [tool],
    });

    expect(mocks.responsesCreate).not.toHaveBeenCalled();
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    expect(mocks.chatCreate.mock.calls[0]?.[0]).toMatchObject({
      model: 'gpt-6-luna',
      reasoning_effort: 'none',
    });
  });
});
