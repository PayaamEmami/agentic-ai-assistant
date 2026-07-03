import { describe, expect, it } from 'vitest';
import {
  extractTextContent,
  mapFinishReason,
  mapMessages,
  mapToolCalls,
  prepareTools,
} from './openai-mappers.js';

describe('mapMessages', () => {
  it('flattens content parts and preserves tool call ids', () => {
    const mapped = mapMessages([
      { role: 'system', content: [{ type: 'text', text: 'sys' }] },
      { role: 'user', content: 'hi' },
      { role: 'tool', content: 'result', toolCallId: 'call-1' },
    ]);

    expect(mapped[0]).toMatchObject({ role: 'system', content: 'sys' });
    expect(mapped[1]).toMatchObject({ role: 'user', content: 'hi' });
    expect(mapped[2]).toMatchObject({ role: 'tool', content: 'result', tool_call_id: 'call-1' });
  });

  it('throws when a tool message lacks a toolCallId', () => {
    expect(() => mapMessages([{ role: 'tool', content: 'x' }])).toThrow(/toolCallId/);
  });
});

describe('prepareTools', () => {
  it('returns undefined tools for an empty list', () => {
    expect(prepareTools([])).toEqual({ tools: undefined, aliasToOriginal: new Map() });
  });

  it('sanitizes names and disambiguates colliding aliases', () => {
    const { tools, aliasToOriginal } = prepareTools([
      { name: 'time.now', description: 'a', parameters: {} },
      { name: 'time/now', description: 'b', parameters: {} },
    ]);

    const aliases = tools?.map((tool) => tool.function.name) ?? [];
    expect(aliases).toEqual(['time_now', 'time_now_2']);
    expect(aliasToOriginal.get('time_now')).toBe('time.now');
    expect(aliasToOriginal.get('time_now_2')).toBe('time/now');
  });
});

describe('mapToolCalls', () => {
  it('resolves aliases back to original tool names', () => {
    const aliasToOriginal = new Map([['time_now', 'time.now']]);
    const calls = mapToolCalls(
      [{ id: 'c1', type: 'function', function: { name: 'time_now', arguments: '{}' } }],
      aliasToOriginal,
    );
    expect(calls).toEqual([{ id: 'c1', name: 'time.now', arguments: '{}' }]);
  });
});

describe('extractTextContent', () => {
  it('joins text and refusal parts, returns null when empty', () => {
    expect(extractTextContent('plain')).toBe('plain');
    expect(
      extractTextContent([
        { type: 'text', text: 'a' },
        { type: 'refusal', refusal: 'no' },
      ]),
    ).toBe('a\nno');
    expect(extractTextContent([])).toBeNull();
    expect(extractTextContent(42)).toBeNull();
  });
});

describe('mapFinishReason', () => {
  it('maps function_call to tool_calls and defaults to stop', () => {
    expect(mapFinishReason('function_call')).toBe('tool_calls');
    expect(mapFinishReason('length')).toBe('length');
    expect(mapFinishReason('something-else')).toBe('stop');
    expect(mapFinishReason(null)).toBe('stop');
  });
});
