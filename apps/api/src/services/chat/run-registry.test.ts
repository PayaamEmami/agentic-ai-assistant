import { describe, expect, it } from 'vitest';
import { ChatRunRegistry } from './run-registry.js';

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

  it('rejects a second start for an in-flight run id', () => {
    const registry = new ChatRunRegistry();
    const first = registry.start('run-1', 'user-1', 'conversation-1');

    expect(() => registry.start('run-1', 'user-1', 'conversation-1')).toThrow(
      /Chat run already active/,
    );
    expect(registry.get('run-1')?.controller).toBe(first.controller);

    registry.finish('run-1');
    const second = registry.start('run-1', 'user-1', 'conversation-1');
    expect(second.controller).not.toBe(first.controller);
  });

  it('aborts only the matching user and conversation', () => {
    const registry = new ChatRunRegistry();
    const matching = registry.start('run-1', 'user-1', 'conversation-1');
    const otherConversation = registry.start('run-2', 'user-1', 'conversation-2');
    const otherUser = registry.start('run-3', 'user-2', 'conversation-1');

    registry.abortForConversation('user-1', 'conversation-1');

    expect(matching.controller.signal.aborted).toBe(true);
    expect(otherConversation.controller.signal.aborted).toBe(false);
    expect(otherUser.controller.signal.aborted).toBe(false);
    expect(registry.listForConversation('user-1', 'conversation-1')).toEqual([matching]);
  });
});
