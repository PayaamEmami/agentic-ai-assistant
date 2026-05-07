import { describe, expect, it } from 'vitest';
import { buildConversationTitle, isAbortError } from './chat-service-helpers.js';

describe('chat service helpers', () => {
  it('builds normalized conversation titles', () => {
    expect(buildConversationTitle('  hello\nthere  ')).toBe('hello there');
    expect(buildConversationTitle('x'.repeat(10), 8)).toBe('xxxxx...');
    expect(buildConversationTitle('   ')).toBeUndefined();
  });

  it('recognizes abort-style errors from supported providers', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(Object.assign(new Error('stop'), { name: 'APIUserAbortError' }))).toBe(true);
    expect(isAbortError(new Error('Chat run interrupted'))).toBe(true);
    expect(isAbortError(new Error('other'))).toBe(false);
  });
});
