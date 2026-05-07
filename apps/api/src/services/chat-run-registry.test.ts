import { describe, expect, it } from 'vitest';
import { ChatRunRegistry } from './chat-run-registry.js';

describe('ChatRunRegistry', () => {
  it('tracks active runs and updates conversation ownership', () => {
    const registry = new ChatRunRegistry();

    const run = registry.start('run-1', 'user-1');
    registry.setConversation('run-1', 'conversation-1');

    expect(registry.get('run-1')).toEqual({
      userId: 'user-1',
      controller: run.controller,
      conversationId: 'conversation-1',
    });

    registry.finish('run-1');
    expect(registry.get('run-1')).toBeUndefined();
  });
});
