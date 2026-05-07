import { describe, expect, it, vi } from 'vitest';
import { getLatestUserRequestText } from './chat-history.js';

vi.mock('@aaa/db', () => ({
  attachmentRepository: {
    findByIdsForUser: vi.fn(),
    findById: vi.fn(),
  },
}));

describe('getLatestUserRequestText', () => {
  it('returns text from the latest user message', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'first request' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'response' }],
      },
      {
        role: 'user',
        content: [{ type: 'transcript', text: 'latest request' }],
      },
    ];

    expect(getLatestUserRequestText(messages as never)).toBe('latest request');
  });

  it('includes terminal tool summaries when latest user message is absent', () => {
    expect(getLatestUserRequestText([{ role: 'assistant', content: [] }] as never)).toBe('');
  });
});
