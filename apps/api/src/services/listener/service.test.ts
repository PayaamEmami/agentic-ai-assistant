import { describe, expect, it } from 'vitest';
import { parseListenerInsights } from './service.js';

describe('listener service helpers', () => {
  it('parses and bounds insight JSON', () => {
    expect(
      parseListenerInsights(
        '```json\n{"insights":[{"title":"Gradient descent","explanation":"An optimizer."}]}\n```',
      ),
    ).toEqual([{ title: 'Gradient descent', explanation: 'An optimizer.' }]);
  });

  it('returns no insights for malformed model output', () => {
    expect(parseListenerInsights('not json')).toEqual([]);
  });
});
