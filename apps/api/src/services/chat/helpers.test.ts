import { describe, expect, it } from 'vitest';
import { buildConversationTitle, readMessageText, rewriteUserMessageContent } from './helpers.js';

describe('chat service helpers', () => {
  it('builds normalized conversation titles', () => {
    expect(buildConversationTitle('  hello\nthere  ')).toBe('hello there');
    expect(buildConversationTitle('x'.repeat(10), 8)).toBe('xxxxx...');
    expect(buildConversationTitle('   ')).toBeUndefined();
  });

  it('rewrites user text and keeps attachment refs', () => {
    const attachment = {
      type: 'attachment_ref',
      attachmentId: 'file-1',
      fileName: 'notes.pdf',
    };
    const content = [{ type: 'text', text: 'Original' }, attachment, { type: 'text', text: 'more' }];

    expect(readMessageText(content)).toBe('Original');
    expect(rewriteUserMessageContent(content, 'Revised')).toEqual([
      { type: 'text', text: 'Revised' },
      attachment,
    ]);
  });
});
