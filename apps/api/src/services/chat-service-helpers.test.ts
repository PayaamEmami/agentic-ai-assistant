import { describe, expect, it } from 'vitest';
import { buildConversationTitle } from './chat-service-helpers.js';

describe('chat service helpers', () => {
  it('builds normalized conversation titles', () => {
    expect(buildConversationTitle('  hello\nthere  ')).toBe('hello there');
    expect(buildConversationTitle('x'.repeat(10), 8)).toBe('xxxxx...');
    expect(buildConversationTitle('   ')).toBeUndefined();
  });
});
