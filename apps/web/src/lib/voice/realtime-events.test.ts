import { describe, expect, it } from 'vitest';
import { parseEvent } from './realtime-events';

describe('voice realtime events', () => {
  it('parses realtime events defensively', () => {
    expect(parseEvent('{"type":"response.done"}')).toEqual({ type: 'response.done' });
    expect(parseEvent('not json')).toBeNull();
  });
});
