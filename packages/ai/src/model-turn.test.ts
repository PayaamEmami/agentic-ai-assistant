import { describe, expect, it, vi } from 'vitest';
import type { ChatProvider } from './model-provider.js';
import { MAX_MODEL_CALLS, runModelTurn } from './model-turn.js';
import type { ChatMessage, CompletionResponse, StreamDelta, ToolCall } from './types.js';

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

function completion(
  content: string | null,
  toolCalls: ToolCall[] = [],
): CompletionResponse {
  return {
    messageId: 'msg',
    content,
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    usage,
  };
}

function provider(responses: CompletionResponse[]): ChatProvider & {
  requests: ChatMessage[][];
} {
  const requests: ChatMessage[][] = [];
  return {
    requests,
    complete: vi.fn(async (request) => {
      requests.push(request.messages);
      const next = responses[requests.length - 1];
      if (!next) {
        throw new Error('unexpected model call');
      }
      return next;
    }),
    streamComplete: async function* () {
      throw new Error('stream is unused in these tests');
    },
  };
}

function streamingProvider(rounds: StreamDelta[][]): ChatProvider & {
  requests: ChatMessage[][];
} {
  const requests: ChatMessage[][] = [];
  return {
    requests,
    complete: async () => {
      throw new Error('complete is unused');
    },
    streamComplete: async function* (request) {
      requests.push(request.messages);
      const round = rounds[requests.length - 1];
      if (!round) {
        throw new Error('unexpected model call');
      }
      yield* round;
    },
  };
}

function searchCall(id: string): ToolCall {
  return { id, name: 'search_workspace', arguments: '{"query":"notes"}' };
}

const tools = [
  { name: 'search_workspace', description: 'Search notes', parameters: {} },
  { name: 'github.list_repositories', description: 'List repos', parameters: {} },
];

describe('runModelTurn', () => {
  it('returns a direct answer without calling inline tools', async () => {
    const model = provider([completion('Hello')]);
    const runInlineTool = vi.fn();

    const result = await runModelTurn({
      provider: model,
      messages: [{ role: 'user', content: 'Hi' }],
      tools,
      inlineToolName: 'search_workspace',
      runInlineTool,
    });

    expect(result.response).toBe('Hello');
    expect(result.toolCalls).toEqual([]);
    expect(result.stagedExternalTools).toBe(false);
    expect(runInlineTool).not.toHaveBeenCalled();
    expect(model.complete).toHaveBeenCalledOnce();
    expect(model.requests[0]?.[0]).toBeDefined();
    expect(model.complete).toHaveBeenCalledWith(
      expect.objectContaining({ hostedWebSearch: true, tools }),
    );
  });

  it('runs workspace search and continues into the answer', async () => {
    const model = provider([
      completion(null, [
        { id: 'call-1', name: 'search_workspace', arguments: '{"query":"resume"}' },
      ]),
      completion('Your resume lists three roles. [Source 1]'),
    ]);
    const runInlineTool = vi.fn(async () => '[Source 1]: Title: Resume\nContent:\nThree roles');

    const result = await runModelTurn({
      provider: model,
      messages: [{ role: 'user', content: 'What is on my resume?' }],
      tools,
      inlineToolName: 'search_workspace',
      runInlineTool,
    });

    expect(runInlineTool).toHaveBeenCalledWith({
      id: 'call-1',
      name: 'search_workspace',
      arguments: { query: 'resume' },
    });
    expect(result.response).toBe('Your resume lists three roles. [Source 1]');
    expect(result.toolCalls).toEqual([]);
    expect(result.inlineResults).toEqual([
      {
        callId: 'call-1',
        name: 'search_workspace',
        arguments: { query: 'resume' },
        output: '[Source 1]: Title: Resume\nContent:\nThree roles',
      },
    ]);
    expect(result.stagedExternalTools).toBe(false);
    expect(model.requests[1]?.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'search_workspace', arguments: '{"query":"resume"}' }],
      },
      {
        role: 'tool',
        content: '[Source 1]: Title: Resume\nContent:\nThree roles',
        toolCallId: 'call-1',
        name: 'search_workspace',
      },
    ]);
  });

  it('stops the turn when the model calls a worker tool', async () => {
    const model = provider([
      completion(null, [
        { id: 'call-2', name: 'github.list_repositories', arguments: '{}' },
      ]),
    ]);
    const runInlineTool = vi.fn();

    const result = await runModelTurn({
      provider: model,
      messages: [{ role: 'user', content: 'List my repos' }],
      tools,
      inlineToolName: 'search_workspace',
      runInlineTool,
    });

    expect(runInlineTool).not.toHaveBeenCalled();
    expect(result.stagedExternalTools).toBe(true);
    expect(result.toolCalls).toEqual([
      { id: 'call-2', name: 'github.list_repositories', arguments: {} },
    ]);
    expect(model.complete).toHaveBeenCalledOnce();
  });

  it('keeps workspace excerpts and stages only the GitHub call when both are requested', async () => {
    const model = provider([
      completion('Checking both.', [
        { id: 'call-1', name: 'search_workspace', arguments: '{"query":"auth"}' },
        { id: 'call-2', name: 'github.list_repositories', arguments: '{}' },
      ]),
    ]);
    const runInlineTool = vi.fn(async () => '[Source 1]: Title: Auth notes');

    const result = await runModelTurn({
      provider: model,
      messages: [{ role: 'user', content: 'Find auth notes and list repos' }],
      tools,
      inlineToolName: 'search_workspace',
      runInlineTool,
    });

    expect(result.response).toBe('Checking both.');
    expect(result.stagedExternalTools).toBe(true);
    expect(result.inlineResults.map((item) => item.output)).toEqual([
      '[Source 1]: Title: Auth notes',
    ]);
    expect(result.toolCalls).toEqual([
      { id: 'call-2', name: 'github.list_repositories', arguments: {} },
    ]);
    expect(model.complete).toHaveBeenCalledOnce();
  });

  it('publishes only the answer after a workspace search', async () => {
    const model = streamingProvider([
      [
        { type: 'text', text: 'Let me look that up.' },
        { type: 'tool_call', toolCall: searchCall('call-1') },
        { type: 'done', finishReason: 'tool_calls', usage },
      ],
      [
        { type: 'text', text: 'Three roles. ' },
        { type: 'text', text: '[Source 1]' },
        { type: 'done', finishReason: 'stop', usage },
      ],
    ]);
    const deltas: string[] = [];

    const result = await runModelTurn({
      provider: model,
      messages: [{ role: 'user', content: 'What is on my resume?' }],
      tools,
      inlineToolName: 'search_workspace',
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      runInlineTool: async () => '[Source 1]: Three roles',
    });

    expect(deltas).toEqual(['Three roles. [Source 1]']);
    expect(result.response).toBe('Three roles. [Source 1]');
  });

  it('answers from the excerpts when every model call is still a workspace search', async () => {
    const rounds: StreamDelta[][] = Array.from({ length: MAX_MODEL_CALLS }, (_, index) => [
      { type: 'text', text: `Looking ${index}.` },
      { type: 'tool_call', toolCall: searchCall(`call-${index}`) },
      { type: 'done', finishReason: 'tool_calls', usage },
    ]);
    rounds.push([{ type: 'done', finishReason: 'stop', usage }]);
    const model = streamingProvider(rounds);
    const excerpts = rounds.slice(0, MAX_MODEL_CALLS).map((_, index) => `[Source ${index + 1}]: Note ${index + 1}`);
    const deltas: string[] = [];

    const result = await runModelTurn({
      provider: model,
      messages: [{ role: 'user', content: 'Find my notes' }],
      tools,
      inlineToolName: 'search_workspace',
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      runInlineTool: async (call) => {
        const index = Number(call.id.replace('call-', ''));
        return excerpts[index] ?? '';
      },
    });

    expect(model.requests).toHaveLength(MAX_MODEL_CALLS + 1);
    expect(result.response).toBe(excerpts.join('\n\n'));
    expect(result.toolCalls).toEqual([]);
    expect(result.stagedExternalTools).toBe(false);
    expect(deltas).toEqual([excerpts.join('\n\n')]);
  });

  it('uses the extra call when it answers after the search cap', async () => {
    const searches = Array.from({ length: MAX_MODEL_CALLS }, (_, index) =>
      completion(null, [searchCall(`call-${index}`)]),
    );
    const model = provider([...searches, completion('The notes say three roles. [Source 1]')]);

    const result = await runModelTurn({
      provider: model,
      messages: [{ role: 'user', content: 'Find my notes' }],
      tools,
      inlineToolName: 'search_workspace',
      runInlineTool: async () => '[Source 1]: Three roles',
    });

    expect(model.requests).toHaveLength(MAX_MODEL_CALLS + 1);
    expect(result.response).toBe('The notes say three roles. [Source 1]');
    expect(result.stagedExternalTools).toBe(false);
  });
});
