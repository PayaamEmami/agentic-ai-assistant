import { describe, expect, it } from 'vitest';
import { isCurrentConversationLoad } from './conversation-load';

describe('isCurrentConversationLoad', () => {
  it('accepts a load that still matches the active conversation and generation', () => {
    expect(
      isCurrentConversationLoad({
        requestedId: 'conversation-a',
        currentId: 'conversation-a',
        loadGeneration: 3,
        currentGeneration: 3,
      }),
    ).toBe(true);
  });

  it('ignores a load after the user switched conversations', () => {
    expect(
      isCurrentConversationLoad({
        requestedId: 'conversation-a',
        currentId: 'conversation-b',
        loadGeneration: 1,
        currentGeneration: 2,
      }),
    ).toBe(false);
  });

  it('ignores a superseded load of the same conversation', () => {
    expect(
      isCurrentConversationLoad({
        requestedId: 'conversation-a',
        currentId: 'conversation-a',
        loadGeneration: 1,
        currentGeneration: 3,
      }),
    ).toBe(false);
  });
});
