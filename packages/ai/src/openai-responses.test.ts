import { describe, expect, it } from 'vitest';
import {
  applyResponsesStreamEvent,
  buildResponsesRequest,
  createResponsesTurnState,
  withWebCitations,
} from './openai-responses.js';

describe('buildResponsesRequest', () => {
  it('offers hosted web search and leaves reasoning alone when there are no function tools', () => {
    const { body } = buildResponsesRequest({
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'What happened today?' }],
    });

    expect(body.tools).toEqual([{ type: 'web_search', search_context_size: 'medium' }]);
    expect(body.tool_choice).toBe('auto');
    expect(body.store).toBe(false);
    expect(body.reasoning).toBeUndefined();
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: 'What happened today?' },
    ]);
  });

  it('keeps function tools on the same request and disables reasoning', () => {
    const { body, aliasToOriginal } = buildResponsesRequest({
      model: 'gpt-5.6-luna',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'Be brief' }] },
        { role: 'tool', content: '4', toolCallId: 'call-1' },
      ],
      tools: [{ name: 'time.now', description: 'Get the time', parameters: { type: 'object' } }],
      maxTokens: 400,
    });

    expect(body.max_output_tokens).toBe(400);
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect(body.tools[0]).toEqual({ type: 'web_search', search_context_size: 'medium' });
    expect(body.tools[1]).toMatchObject({
      type: 'function',
      name: 'time_now',
      strict: false,
    });
    expect(aliasToOriginal.get('time_now')).toBe('time.now');
    expect(body.input[0]).toMatchObject({
      role: 'system',
      content: [{ type: 'input_text', text: 'Be brief' }],
    });
    expect(body.input[1]).toMatchObject({
      role: 'user',
      content: 'Tool result (call-1): 4',
    });
  });

  it('sends Sol function tools with low reasoning and without hosted web search', () => {
    const { body } = buildResponsesRequest({
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'Run the tool' }],
      tools: [{ name: 'time.now', description: 'Get the time', parameters: { type: 'object' } }],
      hostedWebSearch: false,
    });

    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'time_now',
      }),
    ]);
  });
});

describe('applyResponsesStreamEvent', () => {
  it('announces web search once, streams text, and appends a missing citation', () => {
    const state = createResponsesTurnState();
    const aliases = new Map<string, string>();

    expect(
      applyResponsesStreamEvent(
        state,
        { type: 'response.web_search_call.searching' },
        aliases,
      ),
    ).toEqual([{ type: 'web_search' }]);
    expect(
      applyResponsesStreamEvent(
        state,
        { type: 'response.web_search_call.in_progress' },
        aliases,
      ),
    ).toEqual([]);
    expect(
      applyResponsesStreamEvent(
        state,
        { type: 'response.output_text.delta', delta: 'The score was 2-1.' },
        aliases,
      ),
    ).toEqual([{ type: 'text', text: 'The score was 2-1.' }]);

    const completed = applyResponsesStreamEvent(
      state,
      {
        type: 'response.completed',
        response: {
          output_text: 'The score was 2-1.',
          usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
          output: [
            { type: 'web_search_call', id: 'ws_1' },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'The score was 2-1.',
                  annotations: [
                    {
                      type: 'url_citation',
                      url: 'https://example.com/match',
                      title: 'Match report',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      aliases,
    );

    expect(completed).toEqual([
      {
        type: 'text',
        text: '\n\nSources:\n- [Match report](https://example.com/match)',
      },
    ]);
    expect(state.webSearchUsed).toBe(true);
    expect(state.usage).toEqual({ promptTokens: 10, completionTokens: 4, totalTokens: 14 });
  });

  it('does not repeat a citation the answer already includes', () => {
    expect(
      withWebCitations('See https://example.com/match for the report.', [
        { url: 'https://example.com/match', title: 'Match report' },
      ]),
    ).toBe('See https://example.com/match for the report.');
  });

  it('maps a function call alias from the completed response', () => {
    const state = createResponsesTurnState();
    const aliases = new Map([['time_now', 'time.now']]);

    const deltas = applyResponsesStreamEvent(
      state,
      {
        type: 'response.completed',
        response: {
          output: [
            {
              type: 'function_call',
              call_id: 'call_1',
              name: 'time_now',
              arguments: '{}',
            },
          ],
        },
      },
      aliases,
    );

    expect(deltas).toEqual([
      { type: 'tool_call', toolCall: { id: 'call_1', name: 'time.now', arguments: '{}' } },
    ]);
    expect(state.webSearchUsed).toBe(false);
  });

  it('records a failure message', () => {
    const state = createResponsesTurnState();
    applyResponsesStreamEvent(
      state,
      { type: 'response.failed', response: { error: { message: 'model rejected the tool' } } },
      new Map(),
    );
    expect(state.failedMessage).toBe('model rejected the tool');
  });
});
