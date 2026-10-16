import { describe, expect, it } from 'vitest';
import { isPinnedToBottom } from './message-list-scroll';

describe('isPinnedToBottom', () => {
  it('stays pinned at the bottom and for a rounding gap', () => {
    expect(isPinnedToBottom(400, 800, 400)).toBe(true);
    expect(isPinnedToBottom(396, 800, 400)).toBe(true);
  });

  it('lets go once the reader has moved up past the threshold', () => {
    expect(isPinnedToBottom(360, 800, 400)).toBe(false);
  });
});
